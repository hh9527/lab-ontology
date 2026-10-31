"""Stable, meaningful names for source unit contracts (without unit conversion)."""

# Retain distinct source spellings and storage representations as distinct types.
UNIT_NAMES = {
    ('%', 'Float'): 'Percent', ('%', 'Int'): 'IntegerPercent',
    ('ms', 'Float'): 'Milliseconds', ('ms', 'Int'): 'IntegerMilliseconds',
    ('s', 'Float'): 'Seconds', ('s', 'Int'): 'IntegerSeconds',
    ('us', 'Float'): 'Microseconds', ('us', 'Int'): 'IntegerMicroseconds',
    ('pps', 'Float'): 'PacketsPerSecond', ('pps', 'Int'): 'IntegerPacketsPerSecond',
    ('°C', 'Float'): 'DegreesCelsius', ('°C', 'Int'): 'IntegerDegreesCelsius',
    ('W', 'Float'): 'Watts', ('W', 'Int'): 'IntegerWatts',
    ('count', 'Int'): 'Count', ('count', 'Float'): 'FractionalCount',
    ('RPM', 'Float'): 'RevolutionsPerMinute',
    ('B/s', 'Float'): 'BytesPerSecond', ('dBm', 'Float'): 'Dbm',
    ('V', 'Float'): 'Volts', ('V', 'Int'): 'IntegerVolts',
    ('mA', 'Float'): 'Milliamperes', ('A', 'Int'): 'IntegerAmperes',
    ('frames', 'Int'): 'Frames', ('帧', 'Int'): 'FrameCount',
    ('piece', 'Int'): 'Pieces', ('个', 'Int'): 'ItemCount', ('次', 'Int'): 'Occurrences',
    ('MB/s', 'Float'): 'MegabytesPerSecond', ('MB/s', 'Int'): 'IntegerMegabytesPerSecond',
    ('Mbps', 'Float'): 'MegabitsPerSecond', ('KB/s', 'Float'): 'KilobytesPerSecond',
    ('bytes', 'Int'): 'Bytes', ('packets', 'Int'): 'Packets',
    ('uW', 'Float'): 'Microwatts',
    ('GB', 'Float'): 'Gigabytes', ('GB', 'Int'): 'IntegerGigabytes',
    ('KB', 'Float'): 'Kilobytes', ('KB', 'Int'): 'IntegerKilobytes',
    ('MB', 'Int'): 'IntegerMegabytes', ('kWh', 'Float'): 'KilowattHours',
    ('ops', 'Int'): 'Operations', ('ops', 'Float'): 'FractionalOperations',
}


def unit_type_name(unit, storage):
    try:
        return UNIT_NAMES[unit, storage]
    except KeyError:
        raise ValueError(f'Name the source unit contract explicitly: {unit!r}, {storage}') from None
