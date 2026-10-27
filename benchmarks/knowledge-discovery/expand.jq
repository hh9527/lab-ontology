# 模型提供的知识组装程序；宿主只调用 discovery/expand 和通用 fetch。
def canonical: walk(if type == "object" then to_entries | sort_by(.key) | from_entries else . end);
def json: canonical | tojson;
def address($root; $id): $root + "/" + ($id | @uri);
def member($dataset; $kind; $id): address("datasets"; $dataset) + "#" + $kind + "/" + ($id | @uri);
def typeref($types; $id):
  $types[$id] as $t |
  if $t.inline then
    if ["Int","Float","Bool","String"] | index($id) then $id
    else (if $t.kind == "Array" then "Array" elif $t.kind == "Dict" then "Dict" else "Option" end)
      + "(" + ([$t.arguments[] | typeref($types; .)] | join(", ")) + ")"
    end
  else address("types"; $id) end;
def typerefs($types; $id):
  if $types[$id].inline then [$types[$id].arguments[] | typerefs($types; .)[]]
  else [typeref($types; $id)] end;
def typefact($types; $t):
  {key: typeref($types; $t.id), value: {
    name: $t.name, kind: $t.kind,
    representation: (if $t.representation == null then null else typeref($types; $t.representation) end),
    arguments: [$t.arguments[] | typeref($types; .)],
    field_types: [$t.field_types[] | .type = typeref($types; .type)],
    variants: [$t.variants[] | if .payload == null then . else .payload = typeref($types; .payload) end]
  }, references: [$t.dependencies[] | typerefs($types; .)[]]};
def expression($types): .input.type = typeref($types; .input.type);
def bindingfacts($types; $dataset; $b):
  ($b.group | .type = typeref($types; .type)) as $definition |
  address("dimension_groups"; ($definition | json | sha256)) as $group |
  member($dataset; "bindings"; ([$b.members[] | {key:.local,value:.publish}] | from_entries | json)) as $binding |
  [$b.types[] | typerefs($types; .)[]] as $refs |
  {key:$group,value:$definition,references:$refs},
  {key:$binding,value:{group:$group,members:[$b.members[] | .type=typeref($types;.type) | .input |= expression($types)]},references:([$group]+$refs)},
  ($b.members[] | . as $m |
    {key:member($dataset; (if .aggregate == null then "dimensions" else "measures" end); .publish),
     value:{binding:$binding,group:$group,local:.local,type:typeref($types;.type)},
     references:([$binding,$group]+typerefs($types;$m.type))});
def datasetfacts($types; $d):
  {key:address("datasets";$d.id),value:($d|{source,row:typeref($types;.row),grain,kind,scope,clock}),references:typerefs($types;$d.row)},
  ($d.roles[] | . as $r |
    {key:address("entities";.entity),value:{identity:typeref($types;.identity)},references:typerefs($types;.identity)},
    {key:member($d.id;"roles";.id),value:{entity:address("entities";.entity),identity:typeref($types;.identity),optional,
      parts:[.parts[] | .type=typeref($types;.type) | if .raw==null then . else .raw=typeref($types;.raw) end]},
      references:([address("entities";.entity)]+typerefs($types;.identity)+[.parts[] | typerefs($types;.type)[], (if .raw==null then empty else typerefs($types;.raw)[] end)])}),
  ($d.fields[] | . as $f |
    {key:member($d.id;"fields";.name),value:(del(.name)|.type=typeref($types;.type)),references:typerefs($types;$f.type)}),
  ($d.bindings[] | bindingfacts($types;$d.id;.));
def capabilities($d):
  ($d.dimensions[] | member($d.id;"fields";$d.fields[.field].name) as $field |
    {key:member($d.id;"dimensions";.id),value:(del(.id)|.field=$field),references:[$field]}),
  ($d.measures[] | member($d.id;"fields";$d.fields[.field].name) as $field |
    {key:member($d.id;"measures";.id),value:(del(.id,.field)+{anchor_field:$field}),references:[$field]});
def mergefact($f):
  .facts[$f.key] as $previous |
  .facts[$f.key] = (if $previous == null then $f else
    {key:$f.key,value:($previous.value+$f.value),references:($previous.references+$f.references)} end);
def discovery:
  {initial_state:{knowledge_contract:"ontology-knowledge-v4",intent_contract:"ontology-intent-v1",addressing:"node-member-uri-v1",
    revision:.revision,facts:{},items:[],types:{},remaining:(.datasets|length),
    pending:[range(0; .datasets|length) | {path:["datasets",.]}]},keys:[{path:["types"]}]};
def expand($state; $items):
  reduce $items[] as $item ({new_state:$state,keys:[]};
    if $item.key.path == ["types"] then
      .new_state.types = (reduce $item.data[] as $t ({}; .[$t.id]=$t)) |
      reduce ($item.data[] | select(.inline|not)) as $t (.; .new_state |= mergefact(typefact(.types;$t))) |
      .keys += .new_state.pending | .new_state |= del(.pending)
    else
      $item.data as $d |
      reduce (datasetfacts(.new_state.types;$d), capabilities($d)) as $f (.; .new_state |= mergefact($f)) |
      .new_state.remaining -= 1
    end) |
  if .new_state.remaining == 0 then
    .new_state |= (.facts = [.facts[]] | del(.types,.remaining))
  else . end;
if .op == "discovery" then .data | discovery else expand(.state; .items) end
