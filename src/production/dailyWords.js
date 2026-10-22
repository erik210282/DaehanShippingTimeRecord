const words={
 "dx_time_hint": [
  "Captura la hora como 1000 (10:00), en formato de 24 hrs.",
  "Enter time as 1000 (10:00), using the 24-hour format.",
  "시간은 24시간 형식으로 입력하세요. 예: 1000 (10:00)."
 ],
 "dx_extra": [
  "Tiempo Extra",
  "Extra Time",
  "추가 작업 시간"
 ],
 "dx_extra_hint": [
  "Registra los minutos que la máquina trabajó durante Break o Lunch y cuántas personas participaron. No se suman dos veces al turno.",
  "Record minutes the machine ran during Break or Lunch and the number of people involved. Shift time is not counted twice.",
  "휴식 또는 점심시간 중 기계 가동 시간과 참여 인원을 입력하세요. 근무 시간이 중복 계산되지 않습니다."
 ],
 "dx_minutes": [
  "Minutos",
  "Minutes",
  "분"
 ],
 "dx_people": [
  "Personas",
  "People",
  "인원"
 ],
 "dx_extra_invalid": [
  "Revisa los minutos y las personas del tiempo extra. Los minutos no pueden superar los descansos del turno.",
  "Check extra minutes and people. Minutes cannot exceed the shift breaks.",
  "추가 시간과 인원을 확인하세요. 추가 시간은 근무 중 휴식 시간을 초과할 수 없습니다."
 ],
 "dx_more_packing": [
  "Otro Tipo De Empaque",
  "Another Packing Type",
  "포장 유형 추가"
 ],
 "dx_packing_invalid": [
  "Selecciona tipos de empaque distintos y cajas completas válidas; el total no puede superar las piezas buenas.",
  "Choose distinct packing types and valid complete box counts; the total cannot exceed good pieces.",
  "서로 다른 포장 유형과 올바른 완성 상자 수를 선택하세요. 총 수량은 양품 수량을 초과할 수 없습니다."
 ],
 "dx_missing_title": [
  "Partes De La Misma Máquina",
  "Parts On The Same Machine",
  "동일 기계의 제품"
 ],
 "dx_missing_hint": [
  "Hay partes sin reporte listo, sin avance o sin finalizar. ¿Quieres agregarlas para completarlas o procesar solo las disponibles? Las cantidades pendientes deben capturarse antes de enviar.",
  "Some parts have no ready report, no progress, or are unfinished. Add them to complete their details, or process only the available parts. Missing quantities must be entered before submission.",
  "일부 제품은 보고서나 실적이 없거나 완료되지 않았습니다. 추가하여 작성하거나 준비된 제품만 처리하세요. 제출 전에 미입력 수량을 입력해야 합니다."
 ],
 "dx_add_parts": [
  "Agregar Partes Seleccionadas",
  "Add Selected Parts",
  "선택 제품 추가"
 ],
 "dx_only_ready": [
  "Solo Procesar Disponibles",
  "Process Available Parts Only",
  "준비된 제품만 처리"
 ],
 "dx_grouped": [
  "Los reportes con el mismo horario, personal y downtime se imprimen juntos. Los datos diferentes generan hojas separadas.",
  "Reports with matching shift times, staff and downtime print together. Different data generates separate sheets.",
  "근무 시간, 인원 및 비가동 시간이 동일한 보고서는 함께 출력되며 다른 데이터는 별도 페이지로 출력됩니다."
 ]
};export function registerDailyDetails(i18n){for(const [index,lang]of ['es','en','ko'].entries())i18n.addResourceBundle(lang,'translation',Object.fromEntries(Object.entries(words).map(([key,v])=>[key,v[index]])),true,true);}
