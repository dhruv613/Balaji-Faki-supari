-- Keep historical application UUIDs and all their foreign keys when Neon Auth assigns a new subject.
ALTER TABLE public.user_profiles ADD COLUMN auth_subject text;
CREATE UNIQUE INDEX user_profiles_auth_subject_key ON public.user_profiles (auth_subject);
CREATE INDEX user_profiles_normalized_email_idx ON public.user_profiles (lower(btrim(email)));
