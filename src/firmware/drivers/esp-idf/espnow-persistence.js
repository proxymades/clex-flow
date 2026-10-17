// The full owner in the record prevents restoring another project's state even
// if its short NVS namespace happens to collide. No NVS data is erased here.
export function espNowPersistence(projectId, componentId, cString, enabled) {
  if (!enabled) return `static int en_mode_load(int initial){return initial;}
static bool en_mode_save(int mode){(void)mode;return true;}
static void en_mode_clear_error(void){clex_en_status.error[0]=0;}`;
  const owner = projectId + '/' + componentId;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(owner)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const namespace = 'en' + (hash & 0xfffffffffffffn).toString(16).padStart(13, '0');
  return `typedef struct { uint8_t version,mode; char owner[138]; } en_mode_record_t;
static const char en_storage_namespace[]=${cString(namespace)};
static const char en_storage_owner[]=${cString(owner)};
static int en_saved_mode=-1;
static char en_storage_error[128];
static void en_mode_storage_error(const char *operation,esp_err_t err){
 snprintf(en_storage_error,sizeof(en_storage_error),"%s: %s",operation,esp_err_to_name(err));
 en_error(en_storage_error);en_dirty=true;
}
static void en_mode_clear_error(void){snprintf(clex_en_status.error,sizeof(clex_en_status.error),"%s",en_storage_error);}
static int en_mode_load(int initial){
 en_saved_mode=-1;en_storage_error[0]=0;
 nvs_handle_t handle;esp_err_t err=nvs_open(en_storage_namespace,NVS_READONLY,&handle);
 if(err==ESP_ERR_NVS_NOT_FOUND)return initial;
 if(err!=ESP_OK){en_mode_storage_error("Не удалось прочитать режим ESP-NOW",err);return initial;}
 en_mode_record_t record={0};size_t length=sizeof(record);
 err=nvs_get_blob(handle,"tx_mode",&record,&length);nvs_close(handle);
 if(err==ESP_ERR_NVS_NOT_FOUND)return initial;
 if(err!=ESP_OK){en_mode_storage_error("Не удалось прочитать режим ESP-NOW",err);return initial;}
 if(length!=sizeof(record)||record.version!=1||record.mode>1||strncmp(record.owner,en_storage_owner,sizeof(record.owner))){
  en_mode_storage_error("Сохраненный режим ESP-NOW недействителен",ESP_ERR_INVALID_STATE);return initial;
 }
 en_saved_mode=record.mode;return record.mode;
}
static bool en_mode_save(int mode){
 if(en_saved_mode==mode){en_storage_error[0]=0;return true;}
 nvs_handle_t handle;esp_err_t err=nvs_open(en_storage_namespace,NVS_READWRITE,&handle);
 if(err!=ESP_OK){en_mode_storage_error("Режим установлен, но не сохранен",err);return false;}
 en_mode_record_t record={.version=1,.mode=(uint8_t)mode};snprintf(record.owner,sizeof(record.owner),"%s",en_storage_owner);
 err=nvs_set_blob(handle,"tx_mode",&record,sizeof(record));if(err==ESP_OK)err=nvs_commit(handle);nvs_close(handle);
 if(err!=ESP_OK){en_saved_mode=-1;en_mode_storage_error("Режим установлен, но не сохранен",err);return false;}
 en_saved_mode=mode;en_storage_error[0]=0;return true;
}`;
}
