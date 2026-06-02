drop policy if exists "Admins can insert artists"
on public.artists;

drop policy if exists "Admins can update artists"
on public.artists;

create policy "Admins can insert artists"
on public.artists
for insert
to authenticated
with check (public.is_current_user_admin());

create policy "Admins can update artists"
on public.artists
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());
