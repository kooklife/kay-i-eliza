-- Create creative requests table
create table if not exists creative_requests (
    id uuid primary key default gen_random_uuid(),
    raw_content text not null,
    structured_content jsonb not null,
    metadata jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes for common queries
create index if not exists creative_requests_status_idx on creative_requests((metadata->>'status'));
create index if not exists creative_requests_type_idx on creative_requests((metadata->>'type'));
create index if not exists creative_requests_created_at_idx on creative_requests(created_at);

-- Add full text search
alter table creative_requests add column if not exists search_vector tsvector;
create index if not exists creative_requests_search_idx on creative_requests using gin(search_vector);

-- Create function to update search vector
create or replace function creative_requests_search_update() returns trigger as $$
begin
    new.search_vector :=
        setweight(to_tsvector('english', coalesce(new.raw_content,'')), 'B') ||
        setweight(to_tsvector('english', coalesce(new.structured_content->>'brief','')), 'A');
    return new;
end
$$ language plpgsql;

-- Create trigger for search updates
create trigger creative_requests_search_update
    before insert or update
    on creative_requests
    for each row
    execute function creative_requests_search_update();

-- Create function to update timestamp
create or replace function update_creative_requests_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- Create trigger for updating timestamp
create trigger update_creative_requests_timestamp
    before update
    on creative_requests
    for each row
    execute function update_creative_requests_updated_at();

-- Enable RLS
alter table creative_requests enable row level security;

-- Create policies
create policy "Enable read access for all users" on creative_requests for select using (true);
create policy "Enable insert for authenticated users only" on creative_requests for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users only" on creative_requests for update using (auth.role() = 'authenticated');