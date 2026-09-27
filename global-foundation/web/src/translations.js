import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const departments = ['shipping', 'production', 'quality', 'receiving', 'inventory'];
export const departmentNames = {
  shipping: 'Shipping', production: 'Production', quality: 'Calidad',
  receiving: 'Receiving', inventory: 'Inventario',
};

const es = {
  app: 'Sistema global', home: 'Inicio', settings: 'Settings', logout: 'Salir',
  shipping: 'Shipping', production: 'Production', quality: 'Calidad', receiving: 'Receiving', inventory: 'Inventario',
  welcome: 'Bienvenido', departments: 'Departamentos', access: 'Selecciona un departamento para entrar.',
  noAccess: 'No tienes departamentos asignados. Pide acceso al administrador.',
  pending: 'Este departamento está preparado para desarrollarse por etapas.',
  shippingPending: 'Shipping se incorporará aquí cuando se programe su migración. La aplicación actual sigue funcionando por separado.',
  inventoryNote: 'La conciliación mensual del inventario físico se diseñará en la etapa de Inventario.',
  user: 'Usuario', password: 'Contraseña', login: 'Entrar', loading: 'Cargando…',
  inactive: 'La cuenta está inactiva o no existe en operadores.',
  missingConfig: 'Configura la base de pruebas en las variables de entorno para iniciar sesión.',
  error: 'Ocurrió un error', role: 'Rol', assign: 'Asignar acceso', accessAdmin: 'Accesos por departamento',
  announcementAdmin: 'Anuncios', general: 'General', individual: 'Individual', audience: 'Destinatario',
  title: 'Título', message: 'Mensaje', publish: 'Publicar', active: 'Activo', disable: 'Desactivar',
  adminOnly: 'Solo un administrador del sistema puede abrir Settings.',
  chooseUser: 'Selecciona un usuario', chooseDepartment: 'Selecciona un departamento',
  assigned: 'Acceso guardado', published: 'Anuncio publicado', saved: 'Cambios guardados', enable: 'Activar',
  noUsers: 'No hay usuarios disponibles en el entorno de pruebas.', inactiveStatus: 'Inactivo',
  adminSetup: 'El administrador inicial se asigna en la base de pruebas antes de usar esta pantalla.',
  operator: 'Operador', leader: 'Líder', supervisor: 'Supervisor',
};
const en = {
  app: 'Global system', home: 'Home', settings: 'Settings', logout: 'Log out',
  shipping: 'Shipping', production: 'Production', quality: 'Quality', receiving: 'Receiving', inventory: 'Inventory',
  welcome: 'Welcome', departments: 'Departments', access: 'Choose a department to enter.',
  noAccess: 'No departments have been assigned to you. Ask an administrator for access.',
  pending: 'This department is ready to be built in stages.',
  shippingPending: 'Shipping will be added here when its migration is scheduled. The current app continues separately.',
  inventoryNote: 'Monthly physical inventory reconciliation will be designed during the Inventory stage.',
  user: 'User', password: 'Password', login: 'Sign in', loading: 'Loading…',
  inactive: 'This account is inactive or missing from operators.',
  missingConfig: 'Configure the test database environment variables to sign in.',
  error: 'Something went wrong', role: 'Role', assign: 'Assign access', accessAdmin: 'Department access',
  announcementAdmin: 'Announcements', general: 'General', individual: 'Individual', audience: 'Recipient',
  title: 'Title', message: 'Message', publish: 'Publish', active: 'Active', disable: 'Deactivate',
  adminOnly: 'Only a system administrator can open Settings.',
  chooseUser: 'Select a user', chooseDepartment: 'Select a department',
  assigned: 'Access saved', published: 'Announcement published', saved: 'Changes saved', enable: 'Activate',
  noUsers: 'There are no users in the test environment.', inactiveStatus: 'Inactive',
  adminSetup: 'The first administrator is assigned in the test database before using this screen.',
  operator: 'Operator', leader: 'Leader', supervisor: 'Supervisor',
};
const ko = {
  app: '통합 시스템', home: '홈', settings: '설정', logout: '로그아웃',
  shipping: '출하', production: '생산', quality: '품질', receiving: '입고', inventory: '재고',
  welcome: '환영합니다', departments: '부서', access: '부서를 선택하세요.',
  noAccess: '배정된 부서가 없습니다. 관리자에게 문의하세요.',
  pending: '이 부서는 단계별 개발을 위해 준비되었습니다.',
  shippingPending: '출하 기능은 이전 일정에 따라 추가됩니다. 현재 앱은 별도로 운영됩니다.',
  inventoryNote: '월별 실물 재고 조정은 재고 단계에서 설계합니다.',
  user: '사용자', password: '비밀번호', login: '로그인', loading: '불러오는 중…',
  inactive: '계정이 비활성 상태이거나 작업자 목록에 없습니다.',
  missingConfig: '로그인을 위해 테스트 데이터베이스 환경 변수를 설정하세요.',
  error: '오류가 발생했습니다', role: '역할', assign: '접근 권한 배정', accessAdmin: '부서 접근 권한',
  announcementAdmin: '공지사항', general: '전체', individual: '개인', audience: '수신자',
  title: '제목', message: '내용', publish: '게시', active: '활성', disable: '비활성화',
  adminOnly: '시스템 관리자만 설정에 접근할 수 있습니다.',
  chooseUser: '사용자 선택', chooseDepartment: '부서 선택',
  assigned: '권한 저장됨', published: '공지 게시됨', saved: '변경사항 저장됨', enable: '활성화',
  noUsers: '테스트 환경에 사용자가 없습니다.', inactiveStatus: '비활성',
  adminSetup: '첫 번째 관리자는 테스트 데이터베이스에서 지정합니다.',
  operator: '작업자', leader: '리더', supervisor: '관리자',
};

let saved = 'es';
try { saved = localStorage.getItem('lang') || 'es'; } catch { /* storage may be unavailable */ }
i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en }, ko: { translation: ko } },
  lng: ['es', 'en', 'ko'].includes(saved) ? saved : 'es', fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
export default i18n;
