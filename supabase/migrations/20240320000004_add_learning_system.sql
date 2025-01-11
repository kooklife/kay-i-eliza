-- Create learned patterns table
create table if not exists learned_patterns (
    id uuid primary key default gen_random_uuid(),
    field text not null,
    pattern text not null,
    confidence float not null,
    usage_count int default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create field frequency table
create table if not exists field_frequency (
    id uuid primary key default gen_random_uuid(),
    type text not null,
    field text not null,
    count int default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(type, field)
);

-- Create request feedback table
create table if not exists request_feedback (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references creative_requests(id),
    accuracy float not null,
    missing_fields jsonb,
    incorrect_fields jsonb,
    suggested_fields jsonb,
    user_corrections jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes
create index if not exists learned_patterns_field_idx on learned_patterns(field);
create index if not exists learned_patterns_confidence_idx on learned_patterns(confidence);
create index if not exists field_frequency_type_idx on field_frequency(type);
create index if not exists request_feedback_request_id_idx on request_feedback(request_id);
create index if not exists request_feedback_accuracy_idx on request_feedback(accuracy);

-- Enable RLS
alter table learned_patterns enable row level security;
alter table field_frequency enable row level security;
alter table request_feedback enable row level security;

-- Create policies
create policy "Enable read access for all users" on learned_patterns for select using (true);
create policy "Enable insert for authenticated users only" on learned_patterns for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users only" on learned_patterns for update using (auth.role() = 'authenticated');

create policy "Enable read access for all users" on field_frequency for select using (true);
create policy "Enable insert for authenticated users only" on field_frequency for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users only" on field_frequency for update using (auth.role() = 'authenticated');

create policy "Enable read access for all users" on request_feedback for select using (true);
create policy "Enable insert for authenticated users only" on request_feedback for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users only" on request_feedback for update using (auth.role() = 'authenticated');