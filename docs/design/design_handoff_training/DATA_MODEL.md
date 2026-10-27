# Training v1: data model

These follow the repo's conventions:
- every club-owned row has `club_id uuid not null references clubs`;
- RLS is enabled on every table;
- writes go through `security definer` RPCs;
- every write leaves a row in `audit_log`;
- timestamps are `created_at` and `updated_at`.

Number the migrations after the latest one in `supabase/migrations`.

**7 tables**: `exercises`, `training_marks`, `member_marks`, `training_cycles`, `training_routines`, `training_routine_items`, `training_cycle_days`.

```sql
-- Exercise library (global) + club exercises
create table exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references clubs on delete cascade,   -- NULL = global library (seed), set = club's own
  name text not null,
  name_normalized text generated always as (lower(unaccent(trim(name)))) stored,
  tips text[] not null default '{}',
  youtube text,                                      -- full URL or a search query; NULL = search by name
  image_start_path text, image_end_path text,        -- Storage bucket 'exercise-images'
  source text not null check (source in ('library','club')),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index exercises_name_per_scope on exercises (coalesce(club_id,'00000000-0000-0000-0000-000000000000'::uuid), name_normalized);

-- Marks the club defines (v1: kg only)
create table training_marks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs on delete cascade,
  name text not null,
  unit text not null default 'kg' check (unit in ('kg')),   -- widen later: 'seconds','cm','reps'
  sort_order smallint not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (club_id, name)
);

-- Each member's own values: private
create table member_marks (
  member_id uuid not null references members on delete cascade,
  mark_id uuid not null references training_marks on delete cascade,  -- deleting a mark deletes values (UI confirms first)
  value numeric not null check (value > 0),
  updated_at timestamptz default now(),
  primary key (member_id, mark_id)
);

create table training_cycles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs on delete cascade,
  name text not null,
  event_name text, event_date date,          -- optional target event
  start_date date not null,                  -- Monday of week 1 (derived from event_date when set)
  weeks smallint not null check (weeks between 1 and 52),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_by uuid references members,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index one_active_cycle_per_club on training_cycles (club_id) where status = 'active';

create table training_routines (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs on delete cascade,
  cycle_id uuid references training_cycles on delete cascade,  -- NULL = shared (any cycle)
  name text not null,
  color text not null,                       -- auto-assigned from the 6-colour palette
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table training_routine_items (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references training_routines on delete cascade,
  position smallint not null,
  exercise_id uuid not null references exercises,   -- restrict: can't delete an exercise in use
  sets smallint check (sets between 1 and 99),      -- NULL = no sets (e.g. "400 m")
  reps text,                                        -- free text: '8', 'max', '50 m', '30 s'
  rest text,                                        -- free text: '1:30'
  load_kind text not null default 'none' check (load_kind in ('none','pct','text')),
  load_mark_id uuid references training_marks,      -- restrict: can't delete a mark in use
  load_pct numeric check (load_pct > 0 and load_pct <= 150),
  load_text text,
  note text,
  check ((load_kind = 'pct') = (load_mark_id is not null and load_pct is not null)),
  check ((load_kind = 'text') = (load_text is not null))
);

create table training_cycle_days (
  cycle_id uuid not null references training_cycles on delete cascade,
  week_no smallint not null,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Monday
  routine_id uuid not null references training_routines on delete cascade,  -- deleting a routine turns its days into Rest
  primary key (cycle_id, week_no, weekday)                     -- no row = Rest
);
```

Also enforce, in the RPC that saves a day: a routine assigned to a cycle must belong to that cycle, or be shared (`cycle_id is null`).

## RLS (summary)
| Table | Read | Write |
| --- | --- | --- |
| `exercises` with `club_id` null | everyone signed in | migrations only |
| `exercises` with `club_id` set | club members | admin, coach (RPC) |
| `training_marks` | club members | admin, coach (RPC) |
| `member_marks` | **only the owner** (`member_id` = the signed-in member) | only the owner. **No staff read policy, on purpose.** |
| `training_cycles` with status `active`, and their routines, items and days | members for whom `has_training_access(club_id)` is true (active membership or waiver) | admin, coach |
| `training_cycles` with status `draft` or `archived`, and their routines, items and days | admin, coach | admin, coach |
| `training_routines` with `cycle_id` null | as active cycles | admin, coach |

The **mark counts** for staff ("{k} members recorded it") come from a `security definer` function, `mark_usage(mark_id) returns (routine_items int, members int)`, that returns counts only.

## RPCs
- `save_member_mark(mark_id, value)` / `delete_member_mark(mark_id)`: the owner only.
- `save_training_mark(id?, name)`, `delete_training_mark(id)`: the delete fails while any routine item uses the mark, and deletes members' values otherwise.
- `save_club_exercise(id?, name, tips[], youtube, image paths)`, `delete_club_exercise(id)`: the delete fails while the exercise is in use.
- `save_cycle(id?, fields)`: computes `start_date`. `set_cycle_status(id, status)`: making one active archives the previous one, in a single transaction.
- `duplicate_cycle(id)`: deep-copies the cycle's own routines and items, remaps `training_cycle_days`, and leaves shared routines as references. It returns the new cycle's id.
- `save_routine(id?, cycle_id, name)` (assigns the colour on create), `delete_routine(id)`.
- `save_routine_items(routine_id, items jsonb)`: replaces the whole list, with positions in order.
- `set_cycle_day(cycle_id, week_no, weekday, routine_id | null)`, `copy_week_to_all(cycle_id, week_no)`: copies to weeks 2 to N − 2.
- `last_dose(exercise_id)`: the most recent routine item for that exercise in the club, used to pre-fill rows.
- Excel: `export_training_template(cycle_id?)` and `import_training_template(upload_id)`. See `EXCEL_TEMPLATE.md`.

## Seed
- **Library**: import **free-exercise-db** (https://github.com/yuhonas/free-exercise-db, public domain, about 800 exercises).
  - Map each entry to `name`, `tips`, `image_start_path`, `image_end_path` and `source = 'library'`.
  - Upload its images to the `exercise-images` Storage bucket.
  - Set `youtube` to null, so the search uses the name.
- **Sea Dragons**:
  - marks: Back squat, Bench press, Deadlift;
  - club exercises: Front crawl, Dynamic apnea, Fin kick, 25 m sprint, Easy swim;
  - the first cycle: import `Road to Nationals 2027` through the Excel template.
