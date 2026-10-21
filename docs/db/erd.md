# Database ERD (Release 1)

Source of truth: [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma). Design notes and the ORM decision: [schema.md](schema.md).

GitHub renders the diagram below. To edit it, change `schema.prisma` first, then update this file in the same pull request.

```mermaid
erDiagram
    users ||--o{ decks : owns
    users ||--o{ sessions : hosts
    users |o--o{ sessions : "co-hosts"
    users |o--o{ participants : "joins as SSO"

    decks ||--o{ slides : contains
    decks ||--o{ sessions : "is run as"
    decks ||--o{ pdf_imports : "imports from"
    slides ||--o{ reaction_counts : "is reacted on"
    sessions ||--o{ reaction_counts : records

    slides ||--o| activities : "has (kind = activity)"
    activities ||--o{ activity_options : offers

    sessions ||--o{ participants : has
    sessions ||--o{ answers : collects
    sessions ||--o{ questions : "has Q&A"
    sessions ||--o{ session_results : summarizes

    participants ||--o{ answers : gives
    participants |o--o{ questions : asks
    participants ||--o{ question_votes : casts

    activities ||--o{ answers : receives
    activities ||--o{ session_results : "is summarized in"
    activity_options |o--o{ answers : "is chosen in"

    questions ||--o{ question_votes : "gets upvotes"
    questions |o--o{ questions : "duplicates (merged_into_id)"

    users {
        uuid id PK
        text sso_subject UK
        text email
        text display_name
        text student_id
        timestamptz created_at
    }
    decks {
        uuid id PK
        uuid owner_id FK "index (owner_id, updated_at desc)"
        text title
        jsonb settings
        timestamptz created_at
        timestamptz updated_at
    }
    slides {
        uuid id PK
        uuid deck_id FK "index (deck_id, position)"
        int position
        enum kind "text, code, math, image, activity"
        jsonb content
    }
    activities {
        uuid id PK
        uuid slide_id FK, UK
        enum type "live_poll, word_cloud"
        text prompt
        jsonb config
    }
    activity_options {
        uuid id PK
        uuid activity_id FK
        int position
        text label
    }
    sessions {
        uuid id PK
        uuid deck_id FK
        uuid host_id FK "index (host_id, started_at desc)"
        uuid co_host_id FK
        char6 pin "unique while pin_released_at is null"
        enum status "live, host_away, ended"
        jsonb settings
        timestamptz started_at
        timestamptz ended_at
        timestamptz pin_released_at
    }
    participants {
        uuid id PK
        uuid session_id FK "unique (session_id, nickname)"
        uuid user_id FK "unique (session_id, user_id)"
        enum login_type "sso, guest"
        text nickname
        text team
        char64 token_hash UK "SHA-256 of cookie token"
        timestamptz token_expires_at
        timestamptz joined_at
        timestamptz last_seen_at
        timestamptz removed_at
    }
    answers {
        bigint id PK
        uuid session_id FK "unique (session_id, activity_id, participant_id, slot)"
        uuid activity_id FK
        uuid participant_id FK
        uuid option_id FK "poll"
        text text "word cloud"
        text normalized_text "word cloud"
        bool hidden "host hid the word"
        smallint slot
        bool after_reopen
        int points
        timestamptz answered_at
    }
    questions {
        uuid id PK
        uuid session_id FK "index (session_id, created_at)"
        uuid participant_id FK
        text body
        bool is_anonymous
        enum status "visible, highlighted, answered, hidden, merged, deleted"
        uuid merged_into_id FK
        timestamptz created_at
        timestamptz answered_at
    }
    question_votes {
        uuid question_id PK, FK
        uuid participant_id PK, FK
        timestamptz created_at
    }
    reaction_counts {
        uuid session_id PK, FK
        uuid slide_id PK, FK "index (slide_id)"
        text emoji PK
        int count
    }
    pdf_imports {
        uuid id PK
        uuid deck_id FK "index (deck_id, created_at desc)"
        text file_name
        int page_count
        enum status "queued, running, done, failed"
        jsonb pages "per-page progress"
        timestamptz created_at
        timestamptz updated_at
    }
    session_results {
        uuid id PK
        uuid session_id FK "unique (session_id, activity_id)"
        uuid activity_id FK
        enum final_state "draft, live, closed, results_shown"
        int response_count
        jsonb summary
        bool was_reopened
        timestamptz closed_at
    }
```

## Indexes for the main lookups

| Lookup                         | Index                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Session by PIN (join)          | `sessions_pin_active_key`: unique on `pin` where `pin_released_at IS NULL` (partial)    |
| Decks of an owner, newest edit | `decks (owner_id, updated_at DESC)`                                                     |
| Sessions of a host, newest     | `sessions (host_id, started_at DESC)`                                                   |
| Participants of a session      | `participants (session_id, nickname)` and `(session_id, user_id)` unique keys           |
| Resume by cookie token         | `participants (token_hash)` unique                                                      |
| Answers of a session           | `answers (session_id, activity_id)` and the unique key that starts with `session_id`    |
| Questions of a session         | `questions (session_id, created_at)`                                                    |
| Results of a session           | `session_results (session_id, activity_id)` unique                                      |
