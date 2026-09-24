-- Read-only PostgreSQL 16 expression gate. Run with psql -X -v ON_ERROR_STOP=1 -d postgres -f ...
BEGIN READ ONLY;

PREPARE ontology_json_path(text, text, text, bigint) AS
SELECT (json_extract_path_text($1::json, VARIADIC ARRAY[$2::text, $3::text]))::bigint = $4;

DO $$
DECLARE result boolean;
BEGIN
    EXECUTE 'EXECUTE ontology_json_path(''{"a.b":[10,20]}'', ''a.b'', ''-1'', 20)' INTO result;
    IF result IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'structured JSON path or parameter order differs';
    END IF;

    IF json_extract_path('{"n":1e0}'::json, VARIADIC ARRAY['n'::text])::text <> '1e0'
        OR json_extract_path_text('{"n":null}'::json, VARIADIC ARRAY['n'::text]) IS NOT NULL
        OR pg_input_is_valid('{bad}', 'json')
        OR translate('ABCÉ', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') <> 'abcÉ'
        OR to_char(('2024-03-01T00:00:00Z'::timestamptz - make_interval(days => 1))
            AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') <> '2024-02-29T00:00:00Z' THEN
        RAISE EXCEPTION 'PostgreSQL expression semantics differ';
    END IF;
END $$;

DEALLOCATE ontology_json_path;
COMMIT;
