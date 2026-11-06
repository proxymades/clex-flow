use super::{
    check_cancel, classify, cv_classify, cv_encode, Evaluation, Match, Reference, Sample, COEFFS,
    DSP, FRAMES, PCM_COUNT,
};
use sha2::{Digest, Sha256};
use std::{
    ffi::c_void,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

const PHASES: [usize; 4] = [0, 80, 160, 240];
const DISTANCES: [f32; 10] = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0];
const RATIOS: [f32; 7] = [0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97];

type Callback = unsafe extern "C" fn(*const i16, usize, u32, bool, bool, *mut c_void) -> bool;
extern "C" {
    fn kws_endpoint_size() -> usize;
    fn kws_endpoint_reset(state: *mut c_void);
    fn kws_endpoint_push(
        state: *mut c_void,
        samples: *const i16,
        count: usize,
        callback: Callback,
        context: *mut c_void,
    );
}

pub(super) struct Trial {
    truth: i32,
    // First accepted command wins, as in the device's one-command window.
    candidates: Vec<Match>,
}

fn read_pcm(path: &Path, id: &str) -> Result<Option<Vec<i16>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != 96044 {
        return Err("Некорректный аудиофайл для подготовки модели".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() != 96044 {
        return Err("Размер аудиозаписи изменился во время чтения".into());
    }
    if format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Аудиозапись повреждена".into());
    }
    if &bytes[..4] != b"RIFF"
        || &bytes[8..16] != b"WAVEfmt "
        || bytes[16..20] != 16u32.to_le_bytes()
        || bytes[20..22] != 1u16.to_le_bytes()
        || bytes[22..24] != 1u16.to_le_bytes()
        || bytes[24..28] != 16000u32.to_le_bytes()
        || bytes[32..34] != 2u16.to_le_bytes()
        || bytes[34..36] != 16u16.to_le_bytes()
        || &bytes[36..40] != b"data"
        || bytes[40..44] != 96000u32.to_le_bytes()
    {
        return Err("Неверный формат аудиозаписи для подготовки модели".into());
    }
    Ok(Some(
        bytes[44..]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(label: i32, distance: f32, ratio: f32) -> Match {
        Match {
            label: -1,
            candidate: label,
            distance,
            ratio,
        }
    }
    #[test]
    fn calibration_covers_frame_variation_and_keeps_headroom() {
        let trials: Vec<_> = [0.12, 0.156, 0.165, 0.17]
            .into_iter()
            .map(|distance| Trial {
                truth: 0,
                candidates: vec![candidate(0, distance, 0.76)],
            })
            .collect();
        let (distance, ratio) = choose_gate(&trials, 1, false, &AtomicBool::new(false)).unwrap();
        assert!(distance > 0.17 && ratio > 0.76);
        let report = evaluate(&trials, 1, distance, ratio);
        assert_eq!(report.correct, 4);
        assert_eq!(report.wrong, 0);
    }
    #[test]
    fn headroom_must_not_admit_unknown_speech_or_an_earlier_wrong_match() {
        let trials = vec![
            Trial {
                truth: 0,
                candidates: vec![candidate(1, 0.14, 0.76), candidate(0, 0.149, 0.70)],
            },
            Trial {
                truth: 2,
                candidates: vec![candidate(0, 0.17, 0.76)],
            },
        ];
        let (distance, ratio) = choose_gate(&trials, 2, false, &AtomicBool::new(false)).unwrap();
        let report = evaluate(&trials, 2, distance, ratio);
        assert_eq!(report.correct, 1);
        assert_eq!(report.wrong, 0);
        assert_eq!(report.false_commands, 0);
        let relaxed = evaluate(&trials, 2, 0.2, 0.8);
        assert_eq!(relaxed.wrong, 1);
        assert_eq!(relaxed.false_commands, 1);
    }
    #[test]
    fn absent_audio_keeps_feature_only_imports_available() {
        let directory = tempfile::tempdir().unwrap();
        assert!(
            read_pcm(&directory.path().join("missing.wav"), &"0".repeat(64))
                .unwrap()
                .is_none()
        );
        let path = directory.path().join("bad.wav");
        fs::write(&path, b"bad").unwrap();
        assert!(read_pcm(&path, &"0".repeat(64)).is_err());
        assert!(choose_gate(&[], 1, false, &AtomicBool::new(true)).is_err());
    }
}

pub(super) fn load_recordings(
    samples: &[Sample],
    directory: Option<&Path>,
    cancel: &AtomicBool,
) -> Result<Vec<Option<Vec<i16>>>, String> {
    samples
        .iter()
        .map(|sample| {
            check_cancel(cancel)?;
            // Imported projects retain their features even without local WAV files.
            directory.map_or(Ok(None), |directory| {
                read_pcm(&directory.join(format!("{}.wav", sample.id)), &sample.id)
            })
        })
        .collect()
}

struct Stream<'a> {
    references: &'a [Reference],
    commands: usize,
    cancel: &'a AtomicBool,
    candidates: Vec<Match>,
    encoded: Vec<f32>,
    scratch: Vec<i16>,
    mel: Vec<f32>,
}

unsafe extern "C" fn utterance(
    audio: *const i16,
    count: usize,
    voiced: u32,
    too_long: bool,
    _final: bool,
    context: *mut c_void,
) -> bool {
    let stream = unsafe { &mut *(context as *mut Stream<'_>) };
    if stream.cancel.load(Ordering::SeqCst) {
        return true;
    }
    if !too_long && voiced >= 10 {
        let frames = unsafe {
            cv_encode(
                audio,
                count,
                0,
                stream.encoded.as_mut_ptr(),
                stream.scratch.as_mut_ptr(),
                stream.mel.as_mut_ptr(),
            )
        };
        if frames > 0 {
            stream.candidates.push(unsafe {
                cv_classify(
                    stream.encoded.as_ptr(),
                    frames,
                    stream.references.as_ptr(),
                    stream.references.len(),
                    stream.commands as i32,
                    1000.,
                    1.1,
                )
            });
        }
    }
    // Retain rejected previews. A gate is applied to this ordered list later;
    // anything after its first accepted command is ignored.
    false
}

pub(super) fn trials(
    indices: &[usize],
    references: &[usize],
    decoded: &[Vec<i16>],
    labels: &[i32],
    samples: &[Sample],
    commands: usize,
    recordings: &[Option<Vec<i16>>],
    cancel: &AtomicBool,
) -> Result<Vec<Trial>, String> {
    DSP.call_once(|| unsafe { super::cv_features_init() });
    let bank: Vec<Reference> = references
        .iter()
        .map(|&i| Reference {
            data: decoded[i].as_ptr(),
            frames: samples[i].frames as i32,
            label: labels[i],
            scale: samples[i].scale as f32,
        })
        .collect();
    let mut result = Vec::new();
    for &i in indices {
        check_cancel(cancel)?;
        let Some(audio) = &recordings[i] else {
            result.push(Trial {
                truth: labels[i],
                candidates: vec![classify(
                    i, references, decoded, labels, samples, commands, 1000., 1.1,
                )],
            });
            continue;
        };
        for phase in PHASES {
            check_cancel(cancel)?;
            let mut stream = Stream {
                references: &bank,
                commands,
                cancel,
                candidates: Vec::new(),
                encoded: vec![0.; FRAMES * COEFFS],
                scratch: vec![0; PCM_COUNT],
                mel: vec![0.; FRAMES * 32],
            };
            // usize supplies the alignment required by the C endpoint's size_t fields.
            let words = unsafe { kws_endpoint_size() }.div_ceil(std::mem::size_of::<usize>());
            let mut endpoint = vec![0usize; words];
            let state = endpoint.as_mut_ptr().cast::<c_void>();
            let context = (&mut stream as *mut Stream<'_>).cast::<c_void>();
            let mut pcm = vec![0i16; phase];
            pcm.extend_from_slice(audio);
            pcm.resize(pcm.len() + 19200, 0); // Flush the final 1200 ms pause.
            unsafe {
                kws_endpoint_reset(state);
            }
            for chunk in pcm.chunks(512) {
                check_cancel(cancel)?;
                unsafe {
                    kws_endpoint_push(state, chunk.as_ptr(), chunk.len(), utterance, context);
                }
            }
            result.push(Trial {
                truth: labels[i],
                candidates: stream.candidates,
            });
        }
    }
    Ok(result)
}

fn accepted(trial: &Trial, commands: usize, threshold: f32, ratio: f32) -> Option<&Match> {
    trial.candidates.iter().find(|r| {
        r.candidate >= 0
            && r.candidate < commands as i32
            && r.distance <= threshold
            && r.ratio <= ratio
    })
}

pub(super) fn evaluate(
    trials: &[Trial],
    commands: usize,
    threshold: f32,
    ratio: f32,
) -> Evaluation {
    let mut report = Evaluation::default();
    for trial in trials {
        let found = accepted(trial, commands, threshold, ratio);
        report.total += 1;
        if trial.truth < commands as i32 {
            report.commands += 1;
            match found {
                Some(r) if r.candidate == trial.truth => report.correct += 1,
                Some(_) => report.wrong += 1,
                None => report.rejected += 1,
            }
        } else if found.is_some() {
            report.false_commands += 1;
        }
    }
    report
}

fn score(trials: &[Trial], commands: usize, threshold: f32, ratio: f32) -> (usize, usize) {
    let report = evaluate(trials, commands, threshold, ratio);
    (report.wrong + report.false_commands, report.correct)
}

pub(super) fn choose_gate(
    trials: &[Trial],
    commands: usize,
    wake: bool,
    cancel: &AtomicBool,
) -> Result<(f32, f32), String> {
    let mut best = (usize::MAX, 0usize, 0f32, 0f32);
    for threshold in DISTANCES {
        for ratio in RATIOS {
            check_cancel(cancel)?;
            if wake && (threshold > 0.5 || ratio > 0.9) {
                continue;
            }
            let (wrong, correct) = score(trials, commands, threshold, ratio);
            if wrong < best.0 || (wrong == best.0 && correct > best.1) {
                best = (wrong, correct, threshold, ratio);
            }
        }
    }
    if best.1 == 0 {
        return Err("Проверочные записи пока не распознаются уверенно. Добавьте разные примеры команд или замените слишком похожие фразы".into());
    }
    let correct: Vec<_> = trials
        .iter()
        .filter_map(|trial| {
            accepted(trial, commands, best.2, best.3).filter(|r| r.candidate == trial.truth)
        })
        .collect();
    let distance = correct.iter().map(|r| r.distance).fold(0f32, f32::max) * 1.25;
    let ratio = correct.iter().map(|r| r.ratio).fold(0f32, f32::max) + 0.10;
    let distance = DISTANCES
        .into_iter()
        .find(|&v| v >= distance)
        .unwrap_or(1.)
        .max(best.2)
        .min(if wake { 0.5 } else { 1. });
    let ratio = RATIOS
        .into_iter()
        .find(|&v| v >= ratio)
        .unwrap_or(0.97)
        .max(best.3)
        .min(if wake { 0.9 } else { 0.97 });
    // Keep modest headroom for natural variation, but never add a known error
    // or lose a correct validation trial in exchange for that headroom.
    for (threshold, ratio) in [(distance, ratio), (distance, best.3), (best.2, ratio)] {
        if score(trials, commands, threshold, ratio) == (best.0, best.1) {
            return Ok((threshold, ratio));
        }
    }
    Ok((best.2, best.3))
}
