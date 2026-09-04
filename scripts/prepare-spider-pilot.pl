#!/usr/bin/env perl
use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use JSON::PP;
use File::Path qw(make_path);

my $root = shift // ".";
my $data = "$root/spider-data-1";
my $json = JSON::PP->new->canonical;

sub read_json {
    my ($path) = @_;
    open my $fh, "<", $path or die "open $path: $!\n";
    local $/;
    return decode_json(<$fh>);
}

sub normalized_sql {
    my ($sql) = @_;
    $sql = lc $sql;
    $sql =~ s/\s+/ /g;
    $sql =~ s/^ | $//g;
    return $sql;
}

my $questions = read_json("$data/dev.json");
my $tables = read_json("$data/tables.json");
my ($schema) = grep { $_->{db_id} eq "concert_singer" } @$tables;
die "concert_singer schema is missing\n" unless $schema;

my (%groups, @ordered);
for my $index (0 .. $#$questions) {
    my $item = $questions->[$index];
    next unless $item->{db_id} eq "concert_singer";
    my $key = normalized_sql($item->{query});
    push @{$groups{$key}}, [$index, $item];
    push @ordered, $key unless @{$groups{$key}} > 1;
}

make_path("$data/modeling", "$data/eval");
open my $schema_out, ">", "$data/modeling/concert_singer.schema.json"
    or die "open schema output: $!\n";
print {$schema_out} JSON::PP->new->canonical->pretty->encode($schema);
close $schema_out or die "close schema output: $!\n";

open my $model_out, ">", "$data/modeling/concert_singer.examples.jsonl"
    or die "open modeling output: $!\n";
open my $eval_out, ">", "$data/eval/suite-1.jsonl"
    or die "open evaluation output: $!\n";

my %count = (modeling => 0, evaluation => 0);
my %group_count = (modeling => 0, evaluation => 0);
for my $key (@ordered) {
    # Assign the whole normalized-SQL group so paraphrases never cross the boundary.
    my $partition = hex(substr(sha256_hex($key), 0, 8)) % 5 < 3
        ? "modeling" : "evaluation";
    $group_count{$partition}++;
    for my $entry (@{$groups{$key}}) {
        my ($index, $item) = @$entry;
        my $record = {
            id => sprintf("concert_singer-dev-%03d", $index),
            Q => $item->{question},
            R => $item->{query},
            tags => ["concert_singer", $partition],
        };
        $record->{K} = undef if $partition eq "evaluation";
        my $fh = $partition eq "modeling" ? $model_out : $eval_out;
        print {$fh} $json->encode($record), "\n";
        $count{$partition}++;
    }
}
close $model_out or die "close modeling output: $!\n";
close $eval_out or die "close evaluation output: $!\n";

print "modeling: $count{modeling} cases / $group_count{modeling} SQL groups\n";
print "evaluation: $count{evaluation} cases / $group_count{evaluation} SQL groups\n";
