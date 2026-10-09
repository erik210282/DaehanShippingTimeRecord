import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const webUrl = 'https://daehanshippingtimerecord.vercel.app';
const departments = new Set(['shipping', 'production', 'quality', 'receiving', 'inventory']);
const roles = new Set(['operador', 'lider', 'supervisor']);

function response(req: Request, body: Record<string, unknown>, status = 200) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = origin === webUrl || /^http:\/\/localhost:(5173|5174)$/.test(origin);
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : webUrl,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return response(req, {});
  if (req.method !== 'POST') return response(req, { error: 'Method not allowed' }, 405);
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token || !secret || !projectUrl) return response(req, { error: 'Unauthorized' }, 401);

  const db = createClient(projectUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user: caller }, error: authError } = await db.auth.getUser(token);
  if (authError || !caller) return response(req, { error: 'Unauthorized' }, 401);
  const [{ data: person }, { data: admin }, { data: managed }] = await Promise.all([
    db.from('operadores').select('activo').eq('uid', caller.id).maybeSingle(),
    db.from('global_system_admins').select('user_id').eq('user_id', caller.id).maybeSingle(),
    db.from('global_department_memberships').select('department').eq('user_id', caller.id).eq('role', 'supervisor').eq('active', true),
  ]);
  const isAdmin = !!admin;
  const manageable = new Set((managed || []).map(m => m.department));
  if (!person?.activo || (!isAdmin && !manageable.size)) return response(req, { error: 'Forbidden' }, 403);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return response(req, { error: 'Invalid JSON' }, 400); }
  const action = input.action;
  const userId = typeof input.user_id === 'string' ? input.user_id : '';
  const canManage = (department: string) => isAdmin || manageable.has(department);

  async function setupLink(email: string) {
    const { data, error } = await db.auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data?.properties?.hashed_token) throw new Error(error?.message || 'Could not generate link');
    return `${webUrl}/set-password#token_hash=${encodeURIComponent(data.properties.hashed_token)}`;
  }

  try {
    if (action === 'create') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const assignments = Array.isArray(input.assignments) ? input.assignments : [];
      if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || assignments.length < 1 || assignments.length > 5)
        return response(req, { error: 'Invalid user details' }, 400);
      const unique = new Set<string>();
      for (const assignment of assignments) {
        if (!assignment || !departments.has(assignment.department) || !roles.has(assignment.role) || !canManage(assignment.department)
          || (!isAdmin && assignment.role === 'supervisor') || unique.has(assignment.department)) return response(req, { error: 'Invalid assignment' }, 403);
        unique.add(assignment.department);
      }
      const { data: created, error: createError } = await db.auth.admin.createUser({
        email, password: `${crypto.randomUUID()}${crypto.randomUUID()}`, email_confirm: true,
      });
      if (createError || !created.user) return response(req, { error: createError?.message || 'Could not create user' }, 400);
      const uid = created.user.id;
      const shippingSupervisor = assignments.some(a => a.department === 'shipping' && a.role === 'supervisor');
      const { error: profileError } = await db.from('operadores').insert({ uid, nombre: name, email, activo: true, role: shippingSupervisor ? 'supervisor' : 'operador' });
      const { error: assignmentError } = profileError ? { error: profileError } : await db.from('global_department_memberships')
        .insert(assignments.map(a => ({ user_id: uid, department: a.department, role: a.role, active: true })));
      if (assignmentError) {
        await db.from('operadores').delete().eq('uid', uid);
        await db.auth.admin.deleteUser(uid);
        return response(req, { error: assignmentError.message }, 400);
      }
      try { return response(req, { user_id: uid, link: await setupLink(email) }); }
      catch (error) { return response(req, { user_id: uid, error: `User created. ${error instanceof Error ? error.message : 'Could not generate link'}` }, 500); }
    }

    if (!/^[0-9a-f-]{36}$/i.test(userId)) return response(req, { error: 'Invalid user' }, 400);
    const [{ data: target }, { data: targetAdmin }, { data: assignments }] = await Promise.all([
      db.from('operadores').select('id,uid,email,activo').eq('uid', userId).maybeSingle(),
      db.from('global_system_admins').select('user_id').eq('user_id', userId).maybeSingle(),
      db.from('global_department_memberships').select('department,role,active').eq('user_id', userId),
    ]);
    if (!target) return response(req, { error: 'User not found' }, 404);
    const ownRoles = (assignments || []).filter(a => a.active);
    if (!isAdmin && (targetAdmin || !ownRoles.length || ownRoles.some(a => !canManage(a.department) || a.role === 'supervisor')))
      return response(req, { error: 'Forbidden' }, 403);

    if (action === 'link') {
      if (!target.activo) return response(req, { error: 'Inactive user' }, 400);
      // Older accounts can remain banned after their application profile is reactivated.
      const { error: unbanError } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (unbanError) throw unbanError;
      return response(req, { link: await setupLink(target.email) });
    }
    if (!isAdmin || userId === caller.id) return response(req, { error: 'Forbidden' }, 403);
    if (action === 'deactivate') {
      const { error } = await db.from('operadores').update({ activo: false, inactive_since: new Date().toISOString() }).eq('uid', userId);
      if (error) throw error;
      return response(req, { action: 'deactivated' });
    }
    if (action === 'reactivate') {
      const { error: unbanError } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (unbanError) throw unbanError;
      const { error } = await db.from('operadores').update({ activo: true, inactive_since: null }).eq('uid', userId);
      if (error) throw error;
      return response(req, { action: 'reactivated' });
    }
    if (action === 'delete') {
      const [activities, tasks, messages, receipts, sentAnnouncements, addressedAnnouncements, threads] = await Promise.all([
        db.from('actividades_realizadas').select('id', { count: 'exact', head: true }).contains('operadores', [target.id]),
        db.from('tareas_pendientes').select('id', { count: 'exact', head: true }).contains('operadores', [target.id]),
        db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('sender_id', userId),
        db.from('global_announcement_receipts').select('announcement_id', { count: 'exact', head: true }).eq('user_id', userId),
        db.from('global_announcements').select('id', { count: 'exact', head: true }).eq('created_by', userId),
        db.from('global_announcements').select('id', { count: 'exact', head: true }).eq('target_user_id', userId),
        db.from('chat_thread_participants').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
      const checks = [activities, tasks, messages, receipts, sentAnnouncements, addressedAnnouncements, threads];
      if (checks.some(check => check.error)) return response(req, { error: 'Could not verify user history' }, 500);
      if (checks.some(check => (check.count || 0) > 0)) return response(req, { error: 'User has history. Deactivate instead.' }, 409);
      const { error: deleteError } = await db.auth.admin.deleteUser(userId);
      if (deleteError) return response(req, { error: deleteError.message }, 400);
      const { error: profileError } = await db.from('operadores').delete().eq('uid', userId);
      if (profileError) throw profileError;
      return response(req, { action: 'deleted' });
    }
    return response(req, { error: 'Unknown action' }, 400);
  } catch (error) {
    return response(req, { error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
