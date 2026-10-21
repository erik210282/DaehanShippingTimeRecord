import { useTranslation } from "react-i18next";
const messages={
 es:{force:"Forzar Cierre",reason:"Motivo del cierre forzado",notice:"La actividad se cerrará sin validar. Un líder o supervisor deberá revisar y corregir el registro.",pending:"Cierre forzado · pendiente de revisión",required:"Escribe un motivo de al menos 5 caracteres.",saved:"Actividad cerrada. Pendiente de revisión.",review:"Al guardar, el sistema volverá a validar los datos."},
 en:{force:"Force Finish",reason:"Reason for forced closure",notice:"The activity will close without validation. A leader or supervisor must review and correct the record.",pending:"Forced closure · pending review",required:"Enter a reason with at least 5 characters.",saved:"Activity closed. Pending review.",review:"Saving will check the data again."},
 ko:{force:"강제 종료",reason:"강제 종료 사유",notice:"검증 없이 종료됩니다. 리더 또는 감독자가 기록을 검토하고 수정해야 합니다.",pending:"강제 종료 · 검토 대기",required:"사유를 5자 이상 입력하세요.",saved:"종료되었습니다. 검토 대기 중입니다.",review:"저장 시 데이터를 다시 검증합니다."}
};
export function useShippingForceText(){const {i18n}=useTranslation();return key=>(messages[i18n.language?.slice(0,2)]||messages.en)[key];}
