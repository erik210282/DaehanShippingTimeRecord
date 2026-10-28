// Reserved maintenance account. Visibility does not participate in authorization.
export const reservedAdminUserId = 'b291183c-efd7-4686-9fb5-a3d385c23f30';
export const directoryPeople = (people = []) => people.filter(person => person.uid !== reservedAdminUserId);
