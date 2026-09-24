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

PREPARE ontology_set(text, text) AS
WITH "Events"("id", "status") AS
    (VALUES (1, 'left'), (2, 'left'), (1, 'right'), (3, 'right'))
SELECT "__q_0"."id" FROM "Events" AS "__q_0" WHERE "__q_0"."status" = $1
INTERSECT
SELECT "__q_0"."id" FROM "Events" AS "__q_0" WHERE "__q_0"."status" = $2;

PREPARE ontology_set_count(text, text) AS
WITH "Events"("id", "status") AS
    (VALUES (1, 'left'), (2, 'left'), (1, 'right'), (3, 'right'))
SELECT count(1) FROM (
    SELECT "__q_0"."id" FROM "Events" AS "__q_0" WHERE "__q_0"."status" = $1
    INTERSECT
    SELECT "__q_0"."id" FROM "Events" AS "__q_0" WHERE "__q_0"."status" = $2
) AS "__q_1";

PREPARE ontology_exists(text, text, text, integer) AS
WITH "Orders"("id", "role") AS (VALUES (1, 'root'), (2, 'root')),
     "Events"("id", "owner_id", "scope", "kind") AS
         (VALUES (10, 1, 'private', 'alert'), (11, 1, 'private', 'alert'),
                 (12, 2, 'private', 'alert'))
SELECT "o"."id" FROM "Orders" AS "o"
WHERE "o"."role" = $1 AND EXISTS (
    SELECT 1 FROM (SELECT * FROM "Events" AS "e" WHERE "e"."scope" = $2) AS "e"
    WHERE "o"."id" = "e"."owner_id" AND "e"."kind" = $3
    GROUP BY "e"."owner_id" HAVING count("e"."id") > $4);

PREPARE ontology_linked(text, text, text, text) AS
WITH "Orders"("id", "role") AS (VALUES (1, 'root'), (2, 'root')),
     "Hops"("id", "owner_id", "kind") AS
         (VALUES (10, 1, 'first'), (11, 1, 'first'), (12, 2, 'first')),
     "Links"("hop_id", "kind", "state") AS
         (VALUES (10, 'second', 'active'), (11, 'second', 'active'), (12, 'second', 'idle'))
SELECT "o"."id" FROM "Orders" AS "o" WHERE "o"."role" = $1
AND EXISTS (SELECT 1 FROM
    (SELECT * FROM "Hops" AS "h" WHERE "h"."kind" = $2) AS "h"
    INNER JOIN (SELECT * FROM "Links" AS "l" WHERE "l"."kind" = $3) AS "l"
        ON "h"."id" = "l"."hop_id"
    WHERE "o"."id" = "h"."owner_id" AND "l"."state" = $4);

PREPARE ontology_peer(text, text, text, text, text) AS
WITH "Orders"("id", "role", "left_id", "right_id") AS
         (VALUES (1, 'root', 10, 20), (2, 'root', 10, 10)),
     "People"("id", "scope", "role") AS
         (VALUES (10, 'a-scope', 'origin'), (20, 'b-scope', 'peer'))
SELECT "o"."id" FROM "Orders" AS "o" WHERE "o"."role" = $1
AND EXISTS (SELECT 1 FROM
    (SELECT * FROM "People" AS "a" WHERE "a"."scope" = $2) AS "a",
    (SELECT * FROM "People" AS "b" WHERE "b"."scope" = $3) AS "b"
    WHERE (("o"."left_id" = "a"."id" AND "o"."right_id" = "b"."id")
        OR ("o"."right_id" = "a"."id" AND "o"."left_id" = "b"."id"))
    AND "a"."id" <> "b"."id" AND "a"."role" = $4 AND "b"."role" = $5);

PREPARE ontology_scalar(integer, text, text, text, text) AS
WITH "Orders"("id", "total") AS (VALUES (1, 10), (2, 100)),
     "Events"("id", "scope", "status", "kind", "amount") AS
         (VALUES (10, 'private', 'active', 'sale', 10),
                 (11, 'private', 'active', 'sale', 2)),
     "Tags"("event_id", "kind") AS (VALUES (10, 'primary'), (11, 'primary'))
SELECT "o"."id" FROM "Orders" AS "o"
WHERE "o"."total" > (SELECT sum("e"."amount" + $1)
    FILTER (WHERE "e"."kind" = $2)
    FROM (SELECT * FROM "Events" AS "e" WHERE "e"."scope" = $3) AS "e"
    INNER JOIN "Tags" AS "t" ON ("e"."id" = "t"."event_id" AND "t"."kind" = $4)
    WHERE "e"."status" = $5);

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

    EXECUTE 'EXECUTE ontology_set(''left'', ''right'')' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'set operand binding order differs';
    END IF;
    EXECUTE 'EXECUTE ontology_set_count(''left'', ''right'')' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'set-count wrapper differs';
    END IF;

    EXECUTE 'EXECUTE ontology_exists(''root'', ''private'', ''alert'', 1)' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'correlated grouped EXISTS or binding order differs';
    END IF;

    EXECUTE 'EXECUTE ontology_linked(''root'', ''first'', ''second'', ''active'')' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'two-hop correlated EXISTS or binding order differs';
    END IF;
    EXECUTE 'EXECUTE ontology_peer(''root'', ''a-scope'', ''b-scope'', ''origin'', ''peer'')' INTO selected_id;
    IF selected_id IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'paired endpoint identity or binding order differs';
    END IF;
    EXECUTE 'EXECUTE ontology_scalar(2, ''sale'', ''private'', ''primary'', ''active'')'
        INTO selected_id;
    IF selected_id IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'scalar aggregate subquery or clause binding order differs';
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
DEALLOCATE ontology_set;
DEALLOCATE ontology_set_count;
DEALLOCATE ontology_exists;
DEALLOCATE ontology_linked;
DEALLOCATE ontology_peer;
DEALLOCATE ontology_scalar;
COMMIT;
