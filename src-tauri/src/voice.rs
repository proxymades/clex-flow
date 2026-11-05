use crate::idf;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Once,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
const MAX_RECORDS: usize = 128;
const COEFFS: usize = 12;
const FRAMES: usize = 119;
const PCM_COUNT: usize = 38400;
static DSP: Once = Once::new();
#[repr(C)]
struct Reference {
    data: *const i16,
    frames: i32,
    label: i32,
    scale: f32,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Match {
    label: i32,
    candidate: i32,
    distance: f32,
    ratio: f32,
}
extern "C" {
    fn cv_features_init();
    fn cv_encode(
        audio: *const i16,
        count: usize,
        background: i32,
        encoded: *mut f32,
        scratch: *mut i16,
        mel: *mut f32,
    ) -> i32;
    fn cv_classify(
        encoded: *const f32,
        frames: i32,
        references: *const Reference,
        count: usize,
        commands: i32,
        threshold: f32,
        ratio: f32,
    ) -> Match;
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    rms: f64,
    peak: u32,
    clipped: u32,
}
fn default_scale() -> u32 {
    4096
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    id: String,
    kind: String,
    command_id: Option<String>,
    frames: usize,
    data: String,
    #[serde(default = "default_scale")]
    scale: u32,
    quality: Quality,
}
#[derive(Clone, Deserialize)]
pub struct VoiceCommand {
    id: String,
    phrase: String,
}
#[derive(Deserialize)]
pub struct Profile {
    version: u32,
    #[serde(default)]
    purpose: Option<String>,
    commands: Vec<VoiceCommand>,
    samples: Vec<Sample>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    total: usize,
    commands: usize,
    correct: usize,
    rejected: usize,
    wrong: usize,
    false_commands: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    version: u32,
    signature: String,
    reference_ids: Vec<String>,
    threshold: f32,
    ratio: f32,
    ready: bool,
    validation: Evaluation,
    test: Evaluation,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    state: &'a str,
    message: &'a str,
}
fn progress(app: &tauri::AppHandle, id: &str, state: &str, message: &str) {
    let _ = app.emit("voice-progress", Progress { id, state, message });
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Операция остановлена".into())
    } else {
        Ok(())
    }
}
fn valid_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn decode(sample: &Sample) -> Result<Vec<i16>, String> {
    if !valid_hash(&sample.id)
        || sample.frames < 1
        || sample.frames > FRAMES
        || sample.data.len() > 3808
        || ![512, 1024, 2048, 4096].contains(&sample.scale)
    {
        return Err("Некорректные звуковые признаки".into());
    }
    let bytes = STANDARD
        .decode(&sample.data)
        .map_err(|_| "Повреждены звуковые признаки")?;
    if bytes.len() != sample.frames * COEFFS * 2 {
        return Err("Неверный размер звуковых признаков".into());
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect())
}
fn encode(audio: &[i16], background: bool) -> Result<(usize, String, Quality, u32), String> {
    if audio.len() != 48000 {
        return Err("Запись должна длиться 3 секунды".into());
    }
    let mean = audio.iter().map(|&x| x as f64).sum::<f64>() / audio.len() as f64;
    let rms = (audio
        .iter()
        .map(|&x| (x as f64 - mean).powi(2))
        .sum::<f64>()
        / audio.len() as f64)
        .sqrt();
    let quality = Quality {
        rms,
        peak: audio
            .iter()
            .map(|&x| (x as i32).unsigned_abs())
            .max()
            .unwrap_or(0),
        clipped: audio.iter().filter(|&&x| (x as i32).abs() >= 32760).count() as u32,
    };
    if quality.peak == 0 {
        return Err("Микрофон передал только нули. Проверьте аудиоподключение".into());
    }
    if !background {
        let tail = &audio[audio.len() - 320..];
        let m = tail.iter().map(|&v| v as f64).sum::<f64>() / 320.;
        if tail.iter().map(|&v| (v as f64 - m).powi(2)).sum::<f64>() / 320. > 1600. {
            return Err(
                "Речь дошла до конца записи. Повторите фразу чуть раньше или сократите её".into(),
            );
        }
    }
    if quality.clipped > 48 {
        return Err("Микрофон перегружен. Уменьшите усиление или отойдите дальше".into());
    }
    DSP.call_once(|| unsafe { cv_features_init() });
    let mut scratch = vec![0i16; PCM_COUNT];
    let mut mel = vec![0f32; FRAMES * 32];
    let mut output = vec![0f32; FRAMES * COEFFS];
    let frames = unsafe {
        cv_encode(
            audio.as_ptr(),
            audio.len(),
            i32::from(background),
            output.as_mut_ptr(),
            scratch.as_mut_ptr(),
            mel.as_mut_ptr(),
        )
    };
    if frames < 1 {
        return Err("Не удалось выделить короткую фразу. Говорите после надписи «Говорите»; длина команды – до 2,4 секунды".into());
    }
    let (data, scale) = quantize(&output[..frames as usize * COEFFS])?;
    Ok((frames as usize, data, quality, scale))
}
fn quantize(values: &[f32]) -> Result<(String, u32), String> {
    let scale = [4096u32, 2048, 1024, 512]
        .into_iter()
        .find(|&scale| {
            values.iter().all(|value| {
                let v = (*value * scale as f32).round();
                v.is_finite() && v >= i16::MIN as f32 && v <= i16::MAX as f32
            })
        })
        .ok_or("Некорректный уровень звуковых признаков")?;
    let bytes: Vec<u8> = values
        .iter()
        .flat_map(|value| ((*value * scale as f32).round() as i16).to_le_bytes())
        .collect();
    Ok((STANDARD.encode(bytes), scale))
}

fn classify(
    query: usize,
    subset: &[usize],
    decoded: &[Vec<i16>],
    labels: &[i32],
    samples: &[Sample],
    commands: usize,
    threshold: f32,
    ratio: f32,
) -> Match {
    let refs: Vec<Reference> = subset
        .iter()
        .map(|&i| Reference {
            data: decoded[i].as_ptr(),
            frames: samples[i].frames as i32,
            label: labels[i],
            scale: samples[i].scale as f32,
        })
        .collect();
    let q: Vec<f32> = decoded[query]
        .iter()
        .map(|&x| x as f32 / samples[query].scale as f32)
        .collect();
    unsafe {
        cv_classify(
            q.as_ptr(),
            samples[query].frames as i32,
            refs.as_ptr(),
            refs.len(),
            commands as i32,
            threshold,
            ratio,
        )
    }
}
fn evaluate(
    indices: &[usize],
    references: &[usize],
    decoded: &[Vec<i16>],
    labels: &[i32],
    samples: &[Sample],
    commands: usize,
    threshold: f32,
    ratio: f32,
    cancel: &AtomicBool,
) -> Result<Evaluation, String> {
    let mut report = Evaluation::default();
    for &i in indices {
        check_cancel(cancel)?;
        let found = classify(
            i, references, decoded, labels, samples, commands, threshold, ratio,
        );
        report.total += 1;
        if labels[i] < commands as i32 {
            report.commands += 1;
            if found.label == labels[i] {
                report.correct += 1;
            } else if found.label < 0 {
                report.rejected += 1;
            } else {
                report.wrong += 1;
            }
        } else if found.label >= 0 {
            report.false_commands += 1;
        }
    }
    Ok(report)
}
fn prepare(profile: Profile, signature: String, cancel: &AtomicBool) -> Result<Model, String> {
    let n = profile.commands.len();
    let wake = profile.purpose.as_deref() == Some("wake");
    if profile.purpose.as_deref().is_some_and(|p| p != "wake") || (wake && n != 1) {
        return Err("Для активации нужна одна фраза".into());
    }
    if profile.version != 1
        || n < 1
        || n > 32
        || profile.samples.len() > MAX_RECORDS
        || signature.len() != 8
        || !signature.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Некорректный набор голосовых команд".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut phrases = std::collections::HashSet::new();
    for c in &profile.commands {
        if !valid_id(&c.id)
            || !ids.insert(&c.id)
            || c.phrase.trim().is_empty()
            || c.phrase.chars().count() > 80
            || c.phrase.chars().any(char::is_control)
            || !phrases.insert(c.phrase.trim().to_lowercase())
        {
            return Err("Команды должны иметь разные непустые фразы".into());
        }
    }
    let mut decoded = Vec::new();
    let mut labels = Vec::new();
    let mut sample_ids = std::collections::HashSet::new();
    for s in &profile.samples {
        if !sample_ids.insert(&s.id) {
            return Err("Повторяющаяся запись".into());
        }
        let label = match s.kind.as_str() {
            "command" => profile
                .commands
                .iter()
                .position(|c| Some(&c.id) == s.command_id.as_ref())
                .ok_or("Запись относится к удалённой команде")?,
            "unknown" if s.command_id.is_none() => n,
            "background" if s.command_id.is_none() => n + 1,
            _ => return Err("Некорректная метка записи".into()),
        };
        decoded.push(decode(s)?);
        labels.push(label as i32);
    }
    let mut train = Vec::new();
    let mut val = Vec::new();
    let mut test = Vec::new();
    for label in 0..n + 2 {
        let group: Vec<usize> = labels
            .iter()
            .enumerate()
            .filter_map(|(i, &v)| (v == label as i32).then_some(i))
            .collect();
        let minimum = if wake {
            if label < n {
                5
            } else {
                3
            }
        } else if label < n {
            3
        } else {
            2
        };
        if group.len() < minimum {
            return Err(if label < n {
                format!(
                    "Нужны хотя бы {} «{}»",
                    if wake {
                        "пять записей фразы активации"
                    } else {
                        "три записи команды"
                    },
                    profile.commands[label].phrase
                )
            } else {
                format!("Нужны хотя бы {} записи фона и посторонней речи", minimum)
            });
        }
        if group.len() >= 3 {
            test.push(group[group.len() - 1]);
            val.push(group[group.len() - 2]);
            train.extend_from_slice(&group[..group.len() - 2]);
        } else {
            val.push(group[1]);
            train.push(group[0]);
        }
    }
    let raw: Vec<Match> = val
        .iter()
        .map(|&i| {
            classify(
                i,
                &train,
                &decoded,
                &labels,
                &profile.samples,
                n,
                1000.,
                1.1,
            )
        })
        .collect();
    let mut best = (usize::MAX, 0usize, 0f32, 0f32);
    for threshold in [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0] {
        for ratio in [0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97] {
            if wake && (threshold > 0.5 || ratio > 0.9) {
                continue;
            }
            check_cancel(cancel)?;
            let (mut wrong, mut correct) = (0, 0);
            for (&i, result) in val.iter().zip(&raw) {
                if result.candidate < n as i32
                    && result.distance <= threshold
                    && result.ratio <= ratio
                {
                    if result.candidate == labels[i] {
                        correct += 1
                    } else {
                        wrong += 1
                    }
                }
            }
            if wrong < best.0 || (wrong == best.0 && correct > best.1) {
                best = (wrong, correct, threshold, ratio);
            }
        }
    }
    if best.1 == 0 {
        return Err("Проверочные записи пока не распознаются уверенно. Добавьте разные примеры команд или замените слишком похожие фразы".into());
    }
    let (threshold, ratio) = (best.2, best.3);
    let validation = evaluate(
        &val,
        &train,
        &decoded,
        &labels,
        &profile.samples,
        n,
        threshold,
        ratio,
        cancel,
    )?;
    let mut references = train;
    references.extend_from_slice(&val);
    let report = evaluate(
        &test,
        &references,
        &decoded,
        &labels,
        &profile.samples,
        n,
        threshold,
        ratio,
        cancel,
    )?;
    let ready = validation.wrong == 0
        && validation.false_commands == 0
        && report.wrong == 0
        && report.false_commands == 0
        && report.correct > 0;
    Ok(Model {
        version: 1,
        signature,
        reference_ids: references
            .iter()
            .map(|&i| profile.samples[i].id.clone())
            .collect(),
        threshold,
        ratio,
        ready,
        validation,
        test: report,
    })
}
fn read_line<R: Read + ?Sized>(
    port: &mut R,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<String, String> {
    let mut result = Vec::new();
    while Instant::now() < deadline {
        check_cancel(cancel)?;
        let mut b = [0u8];
        match port.read(&mut b) {
            Ok(0) => {}
            Ok(_) => {
                if b[0] == b'\n' {
                    return Ok(String::from_utf8_lossy(&result).trim().to_string());
                }
                if result.len() < 2048 {
                    result.push(b[0]);
                } else {
                    result.clear();
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) => {}
            Err(e) => return Err(format!("USB: {e}")),
        }
    }
    Err("Плата не ответила вовремя".into())
}
fn send(port: &mut dyn serialport::SerialPort, command: &str) -> Result<(), String> {
    port.write_all(format!("\nCLEXVOICE {command}\n").as_bytes())
        .map_err(|e| e.to_string())
}
// USB tools suspend wake detection while they own audio. Restore autonomous
// listening on completion, cancellation or an error, including during capture.
struct VoicePort(Box<dyn serialport::SerialPort>, bool);
impl std::ops::Deref for VoicePort {
    type Target = dyn serialport::SerialPort;
    fn deref(&self) -> &Self::Target {
        &*self.0
    }
}
impl std::ops::DerefMut for VoicePort {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut *self.0
    }
}
impl Drop for VoicePort {
    fn drop(&mut self) {
        let _ = send(&mut *self.0, "START");
    }
}
fn open_port(path: &str, cancel: &AtomicBool) -> Result<VoicePort, String> {
    if !serialport::available_ports()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|p| p.port_name == path)
    {
        return Err("Выбранный USB-порт недоступен".into());
    }
    let mut port = serialport::new(path, 460800)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Не удалось открыть порт: {e}"))?;
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        send(&mut *port, "INFO")?;
        let step = Instant::now() + Duration::from_secs(1);
        while Instant::now() < step {
            let line = match read_line(&mut *port, cancel, step) {
                Ok(v) => v,
                Err(e) => {
                    check_cancel(cancel)?;
                    if Instant::now() < step {
                        return Err(e);
                    } else {
                        break;
                    }
                }
            };
            if line.starts_with("CLEX_VOICE_INFO protocol=1") {
                send(&mut *port, "STOP")?;
                let wait = Instant::now() + Duration::from_secs(3);
                loop {
                    if read_line(&mut *port, cancel, wait)?.starts_with("CLEX_VOICE_STOPPED") {
                        return Ok(VoicePort(
                            port,
                            line.split_whitespace().any(|v| v == "capture=speech"),
                        ));
                    }
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("На плате не обнаружена прошивка голосового компонента. Сначала соберите и запишите её из мастера".into());
        }
    }
}
fn record(
    app: &tauri::AppHandle,
    id: &str,
    path: String,
    kind: String,
    gain: u32,
    cancel: &AtomicBool,
) -> Result<Sample, String> {
    if !["command", "unknown", "background"].contains(&kind.as_str()) {
        return Err("Некорректный тип записи".into());
    }
    if gain > 42 || gain % 6 != 0 {
        return Err("Некорректное усиление микрофона".into());
    }
    progress(app, id, "connecting", "Подключаемся к плате");
    let mut port = open_port(&path, cancel)?;
    let command = recording_command(&kind, port.1)?;
    send(&mut *port, &format!("GAIN {gain}"))?;
    let gain_deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let line = read_line(&mut *port, cancel, gain_deadline)?;
        if line.starts_with("CLEX_VOICE_ERROR") {
            return Err(device_error(&line));
        }
        if line.starts_with("CLEX_VOICE_GAIN") {
            break;
        }
    }
    for number in [2, 1] {
        progress(app, id, "countdown", &number.to_string());
        for _ in 0..20 {
            check_cancel(cancel)?;
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    send(&mut *port, command)?;
    let bytes = receive_recording(
        &mut *port,
        cancel,
        Instant::now() + Duration::from_secs(20),
        |state, message| progress(app, id, state, message),
    )?;
    let _ = send(&mut *port, "STOP");
    drop(port);
    let audio: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    let (frames, data, quality, scale) = encode(&audio, kind == "background")?;
    let mut wav = Vec::with_capacity(bytes.len() + 44);
    wav.extend(b"RIFF");
    wav.extend((bytes.len() as u32 + 36).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(16000u32.to_le_bytes());
    wav.extend(32000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend((bytes.len() as u32).to_le_bytes());
    wav.extend(&bytes);
    let record_id = format!("{:x}", Sha256::digest(&wav));
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice-recordings");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(format!("{record_id}.wav"));
    if !path.exists() {
        let mut temp = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        temp.write_all(&wav).map_err(|e| e.to_string())?;
        temp.persist(&path).map_err(|e| e.to_string())?;
    }
    Ok(Sample {
        id: record_id,
        kind,
        command_id: None,
        frames,
        data,
        scale,
        quality,
    })
}
fn device_error(line: &str) -> String {
    let code = line.trim_start_matches("CLEX_VOICE_ERROR").trim();
    match code {
        "audio_busy" => {
            "Аудиоинтерфейс занят. Дождитесь окончания сигнала и повторите запись".into()
        }
        "model_not_ready" => {
            "На плате нет подготовленной модели. Соберите и запишите обновлённую прошивку".into()
        }
        "invalid_gain" => {
            "Не удалось настроить усиление микрофона. Перезапустите плату и повторите запись".into()
        }
        "microphone_read" | "microphone_timeout" | "microphone_restart" | "capture_mismatch" => {
            "Ошибка захвата звука. Перезапустите плату и повторите запись".into()
        }
        "no_memory" => "Недостаточно памяти для аудиозаписи".into(),
        "speech_timeout" => "Голос не обнаружен. Нажмите запись ещё раз и произнесите фразу".into(),
        _ => format!("Ошибка голосового компонента: {code}"),
    }
}
fn recording_command(kind: &str, speech_capture: bool) -> Result<&'static str, String> {
    if kind == "background" {
        Ok("RECORD 3")
    } else if speech_capture {
        Ok("RECORD 3 SPEECH")
    } else {
        Err("На плате прежняя прошивка записи голоса. Соберите и запишите текущую прошивку кнопками внизу этого окна".into())
    }
}
fn receive_recording<R: Read + ?Sized>(
    port: &mut R,
    cancel: &AtomicBool,
    deadline: Instant,
    notify: impl Fn(&str, &str),
) -> Result<Vec<u8>, String> {
    let header = loop {
        let line = read_line(port, cancel, deadline)?;
        if line.starts_with("CLEX_VOICE_LISTENING") {
            notify(
                "waiting-for-speech",
                "Произнесите фразу. Запись начнётся с голоса",
            );
        }
        if line.starts_with("CLEX_VOICE_RECORDING") {
            notify("recording", "Говорите");
        }
        if line.starts_with("CLEX_VOICE_ERROR") {
            return Err(device_error(&line));
        }
        if line.starts_with("CLEX_VOICE_BEGIN ") {
            break line;
        }
    };
    let fields: Vec<&str> = header.split_whitespace().collect();
    if fields.len() != 6
        || fields[1] != "96000"
        || fields[2] != "16000"
        || fields[3] != "1"
        || fields[4] != "16"
    {
        return Err("Некорректный формат записи с платы".into());
    }
    let expected = u32::from_str_radix(fields[5], 16).map_err(|_| "Повреждён заголовок записи")?;
    notify("transfer", "Получаем запись с платы");
    let mut bytes = vec![0u8; 96000];
    let mut used = 0;
    while used < bytes.len() {
        check_cancel(cancel)?;
        if Instant::now() > deadline {
            return Err("Не удалось получить полную запись".into());
        }
        match port.read(&mut bytes[used..]) {
            Ok(n) => used += n,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    let hash = bytes
        .iter()
        .fold(2166136261u32, |v, &b| (v ^ b as u32).wrapping_mul(16777619));
    if hash != expected {
        return Err("Запись повреждена при USB-передаче. Повторите её".into());
    }
    if !read_line(port, cancel, deadline)?.is_empty()
        || read_line(port, cancel, deadline)? != "CLEX_VOICE_END"
    {
        return Err("Отсутствует конец записи".into());
    }
    Ok(bytes)
}
async fn job<T: Send + 'static>(
    app: tauri::AppHandle,
    inner: Arc<idf::Inner>,
    id: String,
    operation: &'static str,
    work: impl FnOnce(&tauri::AppHandle, &str, &AtomicBool) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let cancel = idf::reserve(&inner, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = work(&app, &id, &cancel);
        idf::finish(
            &app,
            &inner,
            &id,
            operation,
            result.as_ref().map(|_| None).map_err(Clone::clone),
            &cancel,
        );
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn voice_record(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
    id: String,
    port: String,
    kind: String,
    gain_db: u32,
) -> Result<Sample, String> {
    job(
        app,
        state.0.clone(),
        id,
        "voice-record",
        move |app, id, cancel| record(app, id, port, kind, gain_db, cancel),
    )
    .await
}
#[tauri::command]
pub async fn voice_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
    id: String,
    profile: Profile,
    signature: String,
) -> Result<Model, String> {
    job(
        app,
        state.0.clone(),
        id,
        "voice-prepare",
        move |app, id, cancel| {
            progress(
                app,
                id,
                "preparing",
                "Проверяем модель на отдельных записях",
            );
            prepare(profile, signature, cancel)
        },
    )
    .await
}
#[tauri::command]
pub fn voice_audio(app: tauri::AppHandle, id: String) -> Result<String, String> {
    if !valid_hash(&id) {
        return Err("Некорректный ID записи".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice-recordings")
        .join(format!("{id}.wav"));
    let metadata = fs::symlink_metadata(&path).map_err(|_| {
        "Аудиозапись недоступна на этом компьютере. Звуковые признаки сохранены в проекте"
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 160044 {
        return Err("Некорректный аудиофайл".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Аудиозапись повреждена".into());
    }
    Ok(STANDARD.encode(bytes))
}
#[tauri::command]
pub async fn voice_test(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
    id: String,
    port: String,
    signature: String,
) -> Result<(), String> {
    job(
        app,
        state.0.clone(),
        id,
        "voice-test",
        move |app, id, cancel| {
            let mut port = open_port(&port, cancel)?;
            send(&mut *port, "INFO")?;
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let info = read_line(&mut *port, cancel, deadline)?;
                if info.starts_with("CLEX_VOICE_INFO ") {
                    if !info
                        .split_whitespace()
                        .any(|v| v == format!("model={signature}"))
                    {
                        return Err(
                            "На плате другая модель. Соберите и запишите текущий проект".into()
                        );
                    }
                    break;
                }
            }
            send(&mut *port, "START")?;
            progress(app, id, "listening", "Ожидание активации");
            let result = (|| {
                while !cancel.load(Ordering::SeqCst) {
                    match read_line(&mut *port, cancel, Instant::now() + Duration::from_secs(1)) {
                        Ok(line) if line.starts_with("CLEX_VOICE_") => {
                            progress(app, id, "result", &line)
                        }
                        Ok(_) => {}
                        Err(_) if cancel.load(Ordering::SeqCst) => break,
                        Err(e) if e == "Плата не ответила вовремя" => {}
                        Err(e) => return Err(e),
                    }
                }
                Ok(())
            })();
            let _ = send(&mut *port, "STOP");
            result
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(n: usize) -> Profile {
        let commands: Vec<_> = (0..n)
            .map(|i| VoiceCommand {
                id: format!("{:08x}-0000-4000-8000-000000000000", i),
                phrase: format!("Собственная фраза {i}"),
            })
            .collect();
        let mut samples = Vec::new();
        for label in 0..n + 2 {
            for example in 0..5 {
                let values: Vec<i16> = (0..12 * 12)
                    .map(|k| {
                        let dimension = k % 12;
                        ((label + 1) * 1000 + dimension * (label + 2) * 37 + example) as i16
                    })
                    .collect();
                let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
                samples.push(Sample {
                    id: format!("{:064x}", label * 10 + example),
                    kind: if label < n {
                        "command"
                    } else if label == n {
                        "unknown"
                    } else {
                        "background"
                    }
                    .into(),
                    command_id: if label < n {
                        Some(commands[label].id.clone())
                    } else {
                        None
                    },
                    frames: 12,
                    data: STANDARD.encode(bytes),
                    scale: 4096,
                    quality: Quality {
                        rms: 100.,
                        peak: 1000,
                        clipped: 0,
                    },
                });
            }
        }
        Profile {
            version: 1,
            purpose: None,
            commands,
            samples,
        }
    }
    #[test]
    fn arbitrary_vocabularies_prepare_without_fixed_command_names() {
        for n in [1, 4, 9] {
            let model = prepare(fixture(n), "12345678".into(), &AtomicBool::new(false)).unwrap();
            assert!(model.ready);
            assert_eq!(model.test.correct, n);
            assert_eq!(model.test.wrong, 0);
            assert_eq!(model.reference_ids.len(), (n + 2) * 4);
        }
    }
    #[test]
    fn personal_wake_phrase_has_independent_validation_and_rejects_false_activations() {
        let mut profile = fixture(1);
        profile.purpose = Some("wake".into());
        profile.commands[0].phrase = "Добрый вечер, дом".into();
        let model = prepare(profile, "87654321".into(), &AtomicBool::new(false)).unwrap();
        assert!(model.ready);
        assert!(model.threshold <= 0.5 && model.ratio <= 0.9);
        assert_eq!(model.test.total, 3);
        let mut profile = fixture(1);
        profile.purpose = Some("wake".into());
        profile.samples[9].data = profile.samples[4].data.clone();
        let model = prepare(profile, "87654321".into(), &AtomicBool::new(false)).unwrap();
        assert!(!model.ready);
        assert_eq!(model.test.false_commands, 1);
        let mut profile = fixture(1);
        profile.purpose = Some("wake".into());
        profile.samples.remove(0);
        assert!(prepare(profile, "87654321".into(), &AtomicBool::new(false)).is_err());
        let mut profile = fixture(2);
        profile.purpose = Some("wake".into());
        assert!(prepare(profile, "87654321".into(), &AtomicBool::new(false)).is_err());
    }
    #[test]
    fn malformed_or_missing_samples_are_rejected() {
        let mut p = fixture(2);
        p.samples[0].frames = 120;
        assert!(prepare(p, "12345678".into(), &AtomicBool::new(false)).is_err());
        let mut p = fixture(2);
        p.samples
            .retain(|s| s.command_id.as_ref() != Some(&p.commands[1].id));
        assert!(prepare(p, "12345678".into(), &AtomicBool::new(false)).is_err());
        let mut p = fixture(2);
        p.commands[1].phrase = p.commands[0].phrase.clone();
        assert!(prepare(p, "12345678".into(), &AtomicBool::new(false)).is_err());
    }
    #[test]
    fn cancellation_stops_preparation() {
        assert!(prepare(fixture(2), "12345678".into(), &AtomicBool::new(true)).is_err());
    }
    #[test]
    fn raw_audio_is_encoded_and_quiet_or_clipped_speech_is_rejected() {
        let mut audio = vec![0i16; 48000];
        for (i, sample) in audio.iter_mut().enumerate().take(27000).skip(9000) {
            let phase = i as f32 * 0.16;
            *sample = (phase.sin() * 2000. + (phase * 0.71).sin() * 1000.) as i16;
        }
        let (frames, data, quality, scale) = encode(&audio, false).unwrap();
        assert!((20..=119).contains(&frames));
        assert_eq!(STANDARD.decode(data).unwrap().len(), frames * 24);
        assert_eq!(quality.clipped, 0);
        assert!([512, 1024, 2048, 4096].contains(&scale));
        assert!(encode(&vec![0; 48000], false).is_err());
        assert!(encode(&vec![32767; 48000], false).is_err());
    }
    #[test]
    fn held_out_confusion_blocks_deployment() {
        let mut p = fixture(2);
        p.samples[4].data = p.samples[9].data.clone();
        let model = prepare(p, "12345678".into(), &AtomicBool::new(false)).unwrap();
        assert!(!model.ready);
        assert!(model.test.wrong > 0);
    }
    #[test]
    fn recording_modes_require_speech_capture_only_for_phrases() {
        assert_eq!(recording_command("background", false).unwrap(), "RECORD 3");
        assert_eq!(recording_command("background", true).unwrap(), "RECORD 3");
        for kind in ["command", "unknown"] {
            assert!(recording_command(kind, false)
                .unwrap_err()
                .contains("прежняя прошивка"));
            assert_eq!(recording_command(kind, true).unwrap(), "RECORD 3 SPEECH");
        }
        assert!(device_error("CLEX_VOICE_ERROR speech_timeout").contains("Голос не обнаружен"));
    }
    #[test]
    fn usb_recording_validates_frame_format_checksum_footer_and_cancellation() {
        use std::io::Cursor;
        let bytes: Vec<u8> = (0..96000).map(|i| i as u8).collect();
        let hash = bytes
            .iter()
            .fold(2166136261u32, |v, &b| (v ^ b as u32).wrapping_mul(16777619));
        let mut frame = format!(
            "boot message\nCLEX_VOICE_LISTENING\nCLEX_VOICE_RECORDING 3\nCLEX_VOICE_BEGIN 96000 16000 1 16 {hash:08x}\n"
        )
        .into_bytes();
        frame.extend(&bytes);
        frame.extend(b"\nCLEX_VOICE_END\n");
        let cancel = AtomicBool::new(false);
        struct Fragmented {
            inner: Cursor<Vec<u8>>,
        }
        impl Read for Fragmented {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                let size = bytes.len().min(7);
                self.inner.read(&mut bytes[..size])
            }
        }
        let receive = |data: Vec<u8>| {
            receive_recording(
                &mut Fragmented {
                    inner: Cursor::new(data),
                },
                &cancel,
                Instant::now() + Duration::from_secs(1),
                |_, _| {},
            )
        };
        assert_eq!(receive(frame.clone()).unwrap(), bytes);
        let notifications = std::cell::RefCell::new(Vec::new());
        receive_recording(
            &mut Cursor::new(frame.clone()),
            &cancel,
            Instant::now() + Duration::from_secs(1),
            |state, _| notifications.borrow_mut().push(state.to_string()),
        )
        .unwrap();
        assert_eq!(
            *notifications.borrow(),
            ["waiting-for-speech", "recording", "transfer"]
        );
        let mut retried =
            b"CLEX_VOICE_RETRY microphone_read\nCLEX_VOICE_RECOVERED microphone\n".to_vec();
        retried.extend(&frame);
        assert_eq!(receive(retried).unwrap(), bytes);
        let mut bad = frame.clone();
        let start = bad.windows(4).position(|v| v == [0, 1, 2, 3]).unwrap();
        bad[start] ^= 1;
        assert!(receive(bad).unwrap_err().contains("повреждена"));
        let mut converted = Vec::new();
        for &byte in &frame {
            if byte == b'\n' {
                converted.push(b'\r');
            }
            converted.push(byte);
        }
        assert!(receive(converted).unwrap_err().contains("повреждена"));
        assert!(
            receive(b"CLEX_VOICE_BEGIN 96000 48000 1 16 12345678\n".to_vec())
                .unwrap_err()
                .contains("формат")
        );
        let mut bad = frame.clone();
        bad.truncate(bad.len() - 2);
        assert!(receive(bad).is_err());
        assert!(receive(b"CLEX_VOICE_ERROR microphone_read\n".to_vec())
            .unwrap_err()
            .contains("захвата"));
        assert!(receive_recording(
            &mut Cursor::new(frame),
            &AtomicBool::new(true),
            Instant::now() + Duration::from_millis(30),
            |_, _| {}
        )
        .is_err());
    }
    #[test]
    fn feature_storage_handles_large_coefficients_and_mixed_scales() {
        let original = [-35.0f32, -8.2, 17.3, 0.1];
        let (data, scale) = quantize(&original).unwrap();
        assert_eq!(scale, 512);
        let bytes = STANDARD.decode(data).unwrap();
        for (pair, expected) in bytes.chunks_exact(2).zip(original) {
            assert!(
                (i16::from_le_bytes([pair[0], pair[1]]) as f32 / scale as f32 - expected).abs()
                    < 0.002
            );
        }
        let mut profile = fixture(3);
        let mut legacy = serde_json::to_value(&profile.samples[0]).unwrap();
        legacy.as_object_mut().unwrap().remove("scale");
        assert_eq!(
            serde_json::from_value::<Sample>(legacy).unwrap().scale,
            4096
        );
        for sample in profile.samples.iter_mut().step_by(2) {
            let values = decode(sample).unwrap();
            sample.data = STANDARD.encode(
                values
                    .iter()
                    .flat_map(|v| (v / 2).to_le_bytes())
                    .collect::<Vec<_>>(),
            );
            sample.scale = 2048;
        }
        assert!(
            prepare(profile, "12345678".into(), &AtomicBool::new(false))
                .unwrap()
                .ready
        );
        assert!(quantize(&[f32::NAN]).is_err());
    }
}

#[cfg(test)]
mod microphone_pcm_tests {
    #[repr(C)]
    #[derive(Default)]
    struct AdcFilter {
        previous: f32,
        highpass: f32,
        initialized: bool,
    }
    unsafe extern "C" {
        fn cv_pcm_scale(value: f32, gain: f32) -> i16;
        fn cv_i2s_to_pcm(frame: *const i32, right: bool, gain: f32) -> i16;
        fn cv_adc_to_pcm(raw: u32, bits: u32, gain: f32, filter: *mut AdcFilter) -> i16;
    }
    #[test]
    fn microphone_wire_samples_preserve_channel_sign_and_adc_dc_rejection() {
        let frame = [0x12345600, -0x20000000];
        unsafe {
            assert_eq!(cv_i2s_to_pcm(frame.as_ptr(), false, 1.0), 0x1234);
            assert_eq!(cv_i2s_to_pcm(frame.as_ptr(), true, 1.0), -8192);
            assert_eq!(cv_pcm_scale(20000.0, 4.0), i16::MAX);
            assert_eq!(cv_pcm_scale(-20000.0, 4.0), i16::MIN);
            let mut filter = AdcFilter::default();
            for _ in 0..100 {
                assert_eq!(cv_adc_to_pcm(1536, 12, 1.0, &mut filter), 0);
            }
            assert_eq!(cv_adc_to_pcm(2560, 12, 1.0, &mut filter), 16384);
            for _ in 0..2000 {
                cv_adc_to_pcm(2560, 12, 1.0, &mut filter);
            }
            assert!(cv_adc_to_pcm(2560, 12, 1.0, &mut filter).abs() < 2);
        }
    }
}
