DO $$
DECLARE
  password_rows_exist boolean;
BEGIN
  IF to_regclass('public.doxa_auth_mapped_passwords') IS NULL THEN
    RETURN;
  END IF;

  LOCK TABLE public.doxa_auth_mapped_passwords IN ACCESS EXCLUSIVE MODE;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.doxa_auth_mapped_passwords LIMIT 1)'
    INTO password_rows_exist;

  IF password_rows_exist THEN
    RAISE EXCEPTION
      'doxa_auth_mapped_passwords still contains credentials; move each current record into its authoritative external password column with an application-specific compare-and-swap transition before applying this migration';
  END IF;

  EXECUTE 'DROP TABLE public.doxa_auth_mapped_passwords';
END
$$;
