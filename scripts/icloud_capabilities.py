"""Reviewed source-field policy shared by refresh, reconciliation and audit.

Names here identify source vocabulary, not inferred ontology logical types.
Unlisted strings remain exact-only; semantic encodings override search groups.
"""

SEARCH_OPS = ["Eq", "Ne", "Contains", "NotContains", "StartsWith", "EndsWith"]
NUMBER_OPS = ["Eq", "Ne", "Gt", "Ge", "Lt", "Le"]
ADDRESS_COLUMNS = set("ipAddress ip IP aNeIp zNeIp aPortIp zPortIp mgmtIp ipv4Gateway".split())
ADDRESS_TEXT_COLUMNS = ADDRESS_COLUMNS | set("ipv6 mgmtIpv6 ipv6Gateway ipv4Mask ipv6Mask".split())
VERSION_COLUMNS = set("version neOsVersion nePatchVersion biosVersion softVersion hardVersion hotPatchVersion driverVersion firmware firmwareVer firmwareVersion powerVersion softVer".split())
SERIAL_COLUMNS = set("sn esn serialNum serialNumber vendorSn assetNumber barCode bomCode bomId partNumber vendorPn".split())
NAME_COLUMNS = set("name NAME alias SITE_ALIAS SITE_NAME TENANT_NAME ALARMNAME MENAME MONAME ORIGINSYSTEMNAME TENANT REGION AFFECTEDSERVICE accessIfName bmcHostName bondName cardName deviceName diskName driverName fanName ifName interfaceName memoryName osName portName psuName radioName ssidName aNeName zNeName aPortAlias zPortAlias aPortName zPortName".split())
DESCRIPTION_COLUMNS = set("remark description location position LOCATION MOI COMMENT ADDITIONALINFORMATION PROBABLECAUSE".split())
PRODUCT_COLUMNS = set("manufacturer MANUFACTURER vendor vendorName cardManufacturer model productModel productmodel productName PRODUCTNAME belongSeries elecLabel".split())
HARDWARE_ADDRESS_COLUMNS = set("mac MAC macAddress ifPhysAddress wwn fabricWwn remoteNodeWwn remotePortWwn".split())


def category(field):
    ty = field["type"]["type"]
    if ty == "enum" or field.get("dte.enum.values") or field.get("properties", {}).get("dte.enum.values"):
        return "declared-values"
    if ty == "datetime" or field.get("columnType") == "timestamp" or field.get("properties", {}).get("dte.semantic.type") == "time":
        return "clock"
    if ty in {"integer", "long", "float", "double"}:
        return "number"
    if ty == "boolean":
        return "boolean"
    if ty == "uuid" or field.get("isPK") == "Y":
        return "identity"
    name = field["name"]
    for group, columns in (
        ("address-text", ADDRESS_TEXT_COLUMNS), ("version-text", VERSION_COLUMNS),
        ("serial-text", SERIAL_COLUMNS), ("name-text", NAME_COLUMNS),
        ("description-text", DESCRIPTION_COLUMNS), ("product-text", PRODUCT_COLUMNS),
        ("hardware-address-text", HARDWARE_ADDRESS_COLUMNS),
    ):
        if name in columns:
            return group
    return "exact"


def operations(field):
    group = category(field)
    if group.endswith("-text"):
        return "search_text_ops"
    if group == "number":
        return "int_ops"
    if group == "boolean":
        return "bool_ops"
    return "text_ops"


def time_spec(field):
    """Reviewed modeling conventions, not inference from a column name."""
    props = field.get("properties", {})
    ty = field["type"]["type"]
    if ty == "string" and props.get("dte.time.format.pattern") == "YYYY-MM-DD":
        return ("Date", "DateText", "Date", None)
    if ty == "datetime" or (ty == "string" and props.get("dte.semantic.type") == "time"):
        return ("Utc", "CanonicalUtcSecondText", "Utc1", "Model convention: source time String uses UTC second text.")
    if ty in {"integer", "long"} and (field.get("columnType") == "timestamp"
            or props.get("dte.displayName") == "EMSBaseClass.createTime"):
        return ("Utc", "EpochMillis", "EpochMillis", "TODO: Confirm source integer clock unit; provisionally use Unix epoch milliseconds.")
    return None


def address_view(field):
    return category(field) == "address-text" and field["name"] in ADDRESS_COLUMNS


def search_note(field):
    if category(field) == "address-text":
        return "Literal address-text search, not network membership or address normalization."
    return "Raw text search, not semantic ordering or identifier normalization."


def ipv4_note(raw_id):
    return f"Explicit canonical IPv4 view of {raw_id}. Only four decimal octets 0..255 without leading zeros are retained; NULL, IPv6 and other representations produce NULL. No normalization or assertion about all source rows is made. InSubnet/NotInSubnet use CIDR with zero host bits, /0..32; complements exclude NULL and non-IPv4 values. Use {raw_id} for raw text search or non-IPv4 values. This validated computed view does not promise source-column index access."


def ipv4_declaration(raw_id, label):
    import json
    view_id = raw_id + "_ipv4"
    return (
        f'    @edsl::computed_dimension({json.dumps(view_id)}, edsl::OutputType::Text, True, True,\n'
        '        ipv4_ops, ipv4_inputs, edsl::canonical_ipv4_view)\n'
        f'    @edsl::dimension_description({json.dumps(view_id)}, {json.dumps(label + " (IPv4 view)", ensure_ascii=False)},\n'
        f'        {json.dumps(ipv4_note(raw_id))})\n'
    )
