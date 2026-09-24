-- Read-only PostgreSQL 16 expression gate. Run with psql -X -v ON_ERROR_STOP=1 -d postgres -f ...
BEGIN READ ONLY;

PREPARE ontology_json_path(text, text, text, bigint) AS
SELECT (json_extract_path_text($1::json, VARIADIC ARRAY[$2::text, $3::text]))::bigint = $4;

PREPARE ontology_rows(text, text, text, integer, text, integer) AS
WITH "Orders"("Id", "Role") AS (VALUES (1, 'root'), (2, 'root'), (3, 'root')),
     "Customers"("OwnerId", "Role", "Level") AS
         (VALUES (1, 'joined', 7), (2, 'joined', 7))
SELECT $1, "Mixed"."Id"
FROM (SELECT * FROM "Orders" AS "Mixed" WHERE "Mixed"."Role" = $2) AS "Mixed"
LEFT JOIN (SELECT * FROM "Customers" AS "Child" WHERE "Child"."Role" = $3) AS "Child"
    ON ("Mixed"."Id" = "Child"."OwnerId" AND "Child"."Level" = $4)
WHERE "Mixed"."Role" = $5
ORDER BY "Mixed"."Id" ASC NULLS FIRST OFFSET $6;

PREPARE ontology_grouped(text, text, text, integer, text, integer) AS
WITH "Events"("id", "category", "kind") AS
    (VALUES (1, 'A', 'active'), (2, 'A', 'active'), (3, 'A', 'idle'), (4, 'B', 'active'))
SELECT "e"."category", count("e"."id") FILTER (WHERE "e"."kind" = $1) AS "hits"
FROM "Events" AS "e" WHERE "e"."category" = $2
GROUP BY "e"."category"
HAVING count("e"."id") FILTER (WHERE "e"."kind" = $3) > $4
ORDER BY count("e"."id") FILTER (WHERE "e"."kind" = $5) DESC NULLS LAST LIMIT $6;

PREPARE ontology_derived(text, text, text, text, integer, integer) AS
WITH "ItemsA"("id", "role") AS (VALUES (2, 'scope-a'), (0, 'scope-a')),
     "ItemsB"("id") AS (VALUES (11), (12))
SELECT $1, "u"."id"
FROM (SELECT "a"."id" AS "id", $2 AS "tag"
      FROM (SELECT * FROM "ItemsA" AS "a" WHERE "a"."role" = $3) AS "a"
      UNION ALL
      SELECT "b"."id" AS "id", $4 AS "tag"
      FROM "ItemsB" AS "b" WHERE "b"."id" > $5) AS "u"
WHERE "u"."id" > $6 ORDER BY "u"."id" ASC NULLS FIRST;

PREPARE ontology_group_count(text) AS
WITH "Events"("id", "category") AS (VALUES (1, 'A'), (2, 'A'), (3, 'B'))
SELECT count(1) FROM (
    SELECT "__q_0"."category", count("__q_0"."id") AS "hits"
    FROM "Events" AS "__q_0" WHERE "__q_0"."category" = $1
    GROUP BY "__q_0"."category"
) AS "__q_1";

DO $$
DECLARE result boolean;
        selected_name text;
        selected_id integer;
BEGIN
    EXECUTE 'EXECUTE ontology_json_path(''{"a.b":[10,20]}'', ''a.b'', ''-1'', 20)' INTO result;
    IF result IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'structured JSON path or parameter order differs';
    END IF;

    EXECUTE 'EXECUTE ontology_rows(''project'', ''root'', ''joined'', 7, ''root'', 2)'
        INTO selected_name, selected_id;
    IF selected_name IS DISTINCT FROM 'project' OR selected_id IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION 'Rows materialization or placeholder order differs';
    END IF;

    EXECUTE 'EXECUTE ontology_grouped(''active'', ''A'', ''active'', 1, ''active'', 5)'
        INTO selected_name, selected_id;
    IF selected_name IS DISTINCT FROM 'A' OR selected_id IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'grouped aggregate binding order differs';
    END IF;

    EXECUTE 'EXECUTE ontology_derived(''outer'', ''tag-a'', ''scope-a'', ''tag-b'', 10, 1)'
        INTO selected_name, selected_id;
    IF selected_name IS DISTINCT FROM 'outer' OR selected_id IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'derived UNION ALL binding order differs';
    END IF;

    EXECUTE 'EXECUTE ontology_group_count(''A'')' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'group count or internal alias allocation differs';
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
DEALLOCATE ontology_rows;
DEALLOCATE ontology_grouped;
DEALLOCATE ontology_derived;
DEALLOCATE ontology_group_count;
COMMIT;
