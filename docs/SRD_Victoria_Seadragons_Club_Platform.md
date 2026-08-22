# Software Requirements Document (SRD)
## Victoria Seadragons — Underwater Rugby Club Platform

| | |
|---|---|
| **Version** | 1.3 (Draft) |
| **Date** | 15 July 2026 |
| **Author** | Sebastián V. (PacifiCode) |
| **Source** | Claude Design handoff bundle — `Seadragons Platform.dc.html` prototype + stakeholder interview |
| **Status** | For review — v1.1 resolved: casual prepaid packs, coach event permissions, configurable skill categories, minor-consent registration. v1.2 resolved: plan changes at next cycle, Stripe-managed one-off charges, no evaluation versioning, no dashboard export. v1.3 resolved: no pack discounts |

---

## 1. Executive Summary

**Problem statement.** The Victoria Seadragons underwater rugby club (Melbourne) currently manages memberships, training schedules, attendance, team selection, player development, payments, and club communication through fragmented, manual channels. This creates administrative overhead for committee members and coaches, inconsistent communication with players, unbalanced scrimmage teams, and unreliable collection of membership fees.

**Business goals.** Provide a single web platform where the club runs its day-to-day operations: members self-serve their accounts, RSVPs, and payments; coaches manage attendance, evaluations, and team selection; and the committee publishes events and news to targeted audiences.

**Scope summary.** Release 1 delivers a **responsive web application** covering authentication, role-based access, member directory, groups, calendar and events with RSVP, attendance tracking, team builder (manual and auto-balance), player evaluations, news and documents, notifications, and full membership billing via **Stripe**. Release 2 (out of scope for this SRD's functional requirements, but a planning constraint) delivers a **React Native mobile app** replicating the member-facing experience prototyped in the design's mobile views.

---

## 2. Stakeholders

| Stakeholder | Role | Interest |
|---|---|---|
| Club Committee | Governance / product owner | Reduced admin workload, reliable fee collection, member communication |
| Club Administrator(s) | System administrator | User and role management, membership oversight |
| Coaches | Coaching staff | Attendance, evaluations, balanced team selection |
| Players (members) | End users | Schedule visibility, RSVP, own profile and payments |
| Prospective members | External users | Simple sign-up and membership selection |
| Australian Underwater Federation (AUF) | External body | Members hold valid AUF registration (numbers and expiry tracked by the club) |
| Stripe | Payment provider | Card billing, subscriptions, and payment status |

---

## 3. Scope

### 3.1 In Scope (Release 1)

- Account sign-up, sign-in (email/password, Google, Apple), password reset, sign-out
- Role model (Admin, Coach, Committee, Player), role requests, and role-based access control
- Member directory with search, filter, sort; admin-managed member creation with email invite
- Groups for audience targeting (events, news) and member organisation
- Calendar and events: one-time and weekly recurring events, four event types, agenda view, RSVP
- Attendance capture per training session with per-member attendance statistics
- Team builder for events: manual assignment and auto-balance with strength comparison and swap suggestion
- Player evaluations: configurable skill categories (default set of 10), computed overall score, coach/admin-only visibility
- News & documents feed with categories, file attachments, and group targeting
- Membership plans and billing via Stripe: recurring monthly plans, prepaid casual session packs, payment history, failed-payment recovery
- In-app notification centre with unread indicators
- Dashboard with club statistics, upcoming events, and latest news
- Global search across members, events, and news
- Light and dark theme

### 3.2 Out of Scope (Release 1)

- Native mobile app (React Native) — deferred to Release 2; the prototype's mobile screens define its target scope
- PayPal integration (prototype shows it as "integration-ready" only)
- Multi-club / multi-tenant operation (see CON-004)
- Match/game statistics and results tracking
- Direct messaging or chat between members
- Month and week calendar visualisations (agenda list view is the Release 1 requirement; see FR-034)
- Dashboard data export (the prototype's "Export" control is removed from scope)
- Per-season evaluation history/versioning (each member has a single current evaluation)
- Public-facing marketing website

---

## 4. User Roles

| Role | Description |
|---|---|
| **Admin** | Full access: manage users and roles, view/edit evaluations, publish events and news, manage teams and attendance, manage groups and memberships. |
| **Coach** | View and edit player evaluations, configure evaluation skill categories, build teams, record attendance. Cannot create events, publish news, or manage users. |
| **Committee** | Publish news/documents and create events; manage groups. No access to evaluation scores or user administration. |
| **Player** | Default role for all new accounts. View directory, calendar, news; RSVP to events; manage own profile, membership, and payments. Cannot view any evaluation scores, including their own. |

Permission matrix (from the validated prototype):

| Capability | Admin | Coach | Committee | Player |
|---|:-:|:-:|:-:|:-:|
| View evaluation scores (OVR / ratings) | ✔ | ✔ | ✖ | ✖ |
| Publish news & documents | ✔ | ✖ | ✔ | ✖ |
| Create events | ✔ | ✖ | ✔ | ✖ |
| Manage users & roles | ✔ | ✖ | ✖ | ✖ |
| Team builder & attendance | ✔ | ✔ | ✖ | ✖ |
| Manage groups | ✔ | ✔ | ✔ | ✖ |
| View directory, calendar, news; RSVP; own profile & payments | ✔ | ✔ | ✔ | ✔ |

---

## 5. Business Requirements

| ID | Business Requirement |
|---|---|
| BR-001 | The club needs to centralise member, role, and club administration in one system to reduce manual administrative work. |
| BR-002 | The club needs to coordinate training sessions and events, know who is attending in advance, and record who actually attended. |
| BR-003 | The club needs to form balanced scrimmage teams quickly and objectively, instead of ad-hoc selection. |
| BR-004 | The coaching staff needs to track player skill development over time in a structured, private way. |
| BR-005 | The club needs to collect membership fees reliably and recover failed payments, to sustain club finances. |
| BR-006 | The club needs to communicate announcements, news, and documents to the right audience in a timely, verifiable way. |
| BR-007 | The club needs access to features and sensitive data (evaluations, user administration, billing) to be controlled by role, respecting member privacy. |
| BR-008 | The club needs to keep federation (AUF) registration records for members current and visible to administrators. |

---

## 6. Functional Requirements

### 6.1 Authentication & Accounts

| ID | Requirement |
|---|---|
| FR-001 | The system shall allow a visitor to create an account with full name, email address, and password. |
| FR-002 | The system shall reject any password shorter than 8 characters at account creation and password reset. |
| FR-003 | The system shall allow a registered user to sign in with email and password. |
| FR-004 | The system shall allow a user to sign in or sign up using their Google account. |
| FR-005 | The system shall allow a user to sign in or sign up using their Apple account. |
| FR-006 | The system shall allow a user to request a password reset link delivered to their registered email address. |
| FR-007 | The system shall allow a signed-in user to sign out from any screen. |
| FR-008 | The system shall assign the Player role to every newly created account. |
| FR-009 | The system shall require the user to select a membership type (Full, Student, Family, or Casual) during sign-up. |
| FR-010 | The system shall allow a user to submit a role request for Coach or Committee, with an optional justification text. |
| FR-011 | The system shall allow an Admin to approve or reject pending role requests. |
| FR-081 | The system shall capture the registrant's date of birth during account sign-up and member creation. |
| FR-082 | The system shall, when a registrant's date of birth indicates they are under 18, require a parent/guardian's name, email, and explicit consent during registration, and shall not activate the account until that consent is recorded. |

### 6.2 Roles & Access Control

| ID | Requirement |
|---|---|
| FR-012 | The system shall support exactly four roles: Admin, Coach, Committee, and Player. |
| FR-013 | The system shall restrict access to every feature according to the permission matrix in Section 4, for both navigation and direct requests. |
| FR-014 | The system shall allow an Admin to change any member's role from that member's profile. |

### 6.3 Member Directory

| ID | Requirement |
|---|---|
| FR-015 | The system shall display a directory of all club members showing name, country, experience level, role, position, and attendance percentage. |
| FR-016 | The system shall display each member's overall evaluation score (OVR) in the directory only when the viewing user is an Admin or Coach. |
| FR-017 | The system shall allow users to search the directory by member name. |
| FR-018 | The system shall allow users to filter the directory by role (All, Player, Coach, Committee, Admin). |
| FR-019 | The system shall allow users to sort the directory by member name, role, position, OVR (where visible), and attendance, in ascending or descending order. |
| FR-020 | The system shall allow an Admin to create a member record with full name, email, position (Goalkeeper, Defender, Forward), experience level (Beginner, Intermediate, Advanced), gender, AUF number, AUF expiry date, and group assignments. |
| FR-021 | The system shall send an email invitation to a newly created member so they can activate their account. |
| FR-022 | The system shall display, on a member's own profile, their attendance percentage and total sessions attended. |

### 6.4 Groups

| ID | Requirement |
|---|---|
| FR-023 | The system shall allow authorised users (Admin, Coach, Committee) to create a group with a name. |
| FR-024 | The system shall display the list of groups with each group's member count. |
| FR-025 | The system shall allow authorised users to delete a group. |
| FR-026 | The system shall allow members to be assigned to one or more groups, at member creation and afterwards. |
| FR-027 | The system shall allow groups to be used as the target audience when creating events and publishing news. |

### 6.5 Calendar & Events

| ID | Requirement |
|---|---|
| FR-028 | The system shall allow an Admin or Committee member to create a one-time event with title, type, date, time, location, notes, and target audience (all members or selected groups). |
| FR-029 | The system shall support four event types: Training, Competition, Meeting, and Social. |
| FR-030 | The system shall allow an Admin or Committee member to create a weekly recurring event by selecting one or more days of the week, a start date, and an end date. |
| FR-031 | The system shall generate an individual event occurrence for each matching day within a recurring event's date range. |
| FR-032 | The system shall display to each member only the events whose target audience includes that member. |
| FR-033 | The system shall display events in an agenda list showing date, title, type, time, location, and RSVP summary. |
| FR-034 | The system shall record a member's RSVP to an event as one of: Yes, Maybe, or No. |
| FR-035 | The system shall allow a member to change their RSVP at any time before the event starts. |
| FR-036 | The system shall display aggregated RSVP counts (going / maybe) for each event. |
| FR-037 | The system shall notify all targeted members when a new event or recurring series is created. |

### 6.6 Attendance

| ID | Requirement |
|---|---|
| FR-038 | The system shall allow an Admin or Coach to record each member's attendance for a training session as Present, Late, or Absent. |
| FR-039 | The system shall default each member's attendance status to Present for a new session record. |
| FR-040 | The system shall display live summary counts of Present, Late, and Absent while attendance is being recorded. |
| FR-041 | The system shall persist a session's attendance records when the recorder saves, and confirm the save to the recorder. |
| FR-042 | The system shall compute each member's attendance percentage from their saved attendance records and display it in the directory, member profile, and dashboard statistics. |

### 6.7 Team Builder

| ID | Requirement |
|---|---|
| FR-043 | The system shall allow an Admin or Coach to split an event's squad into two named teams. |
| FR-044 | The system shall, in manual mode, allow the builder to assign each available player to either team and to remove a player back to the available pool. |
| FR-045 | The system shall display live totals for each team (player count, combined score, average strength) and the point difference between teams while building. |
| FR-046 | The system shall, in auto-balance mode, distribute the squad into two teams using players' overall evaluation scores such that the difference in combined score between teams is minimised, while ensuring each team has position coverage (at least one goalkeeper, defenders, and forwards where the squad allows). |
| FR-047 | The system shall present a suggested player swap when a swap would reduce the strength difference or improve position coverage. |
| FR-048 | The system shall show each assigned player which team they are on and their team's full lineup for the event. |
| FR-049 | The system shall notify a player when they are assigned to a team for an event. |

### 6.8 Player Evaluations

| ID | Requirement |
|---|---|
| FR-050 | The system shall allow an Admin or Coach to record a player evaluation consisting of a 1–10 integer rating for each skill category in the club's configured category set (default set: Fitness, Speed, Endurance, Experience, Game awareness, Tactical, Passing, Ball control, Defense, and Teamwork). |
| FR-051 | The system shall initialise a new evaluation with every configured category's rating set to 5. |
| FR-052 | The system shall compute a player's overall score (OVR) as the arithmetic mean of **all** category ratings in the evaluation — every configured skill counts toward the total — displayed to one decimal place. |
| FR-053 | The system shall allow an Admin or Coach to configure the set of skill categories used in evaluations (add, rename, deactivate); changes shall apply to evaluations created or edited after the change. |
| FR-054 | The system shall allow an Admin or Coach to edit an existing evaluation's ratings and save the changes. |
| FR-055 | The system shall restrict all evaluation data (category ratings and OVR) to Admin and Coach users; a Player shall not be able to view any evaluation scores, including their own. |
| FR-056 | The system shall display an explanatory "ratings are private" notice where a score would otherwise appear for users without evaluation access. |

### 6.9 News & Documents

| ID | Requirement |
|---|---|
| FR-057 | The system shall allow an Admin or Committee member to publish a post with a category (Announcement, News, or Document), a title, and a body. |
| FR-058 | The system shall allow file attachments (PDF, document, and image formats) on a post. |
| FR-059 | The system shall allow the publisher to target a post to all members or to selected groups. |
| FR-060 | The system shall display to each member a reverse-chronological feed of the posts targeted to them, showing category, title, excerpt, author, publication date, and attachment indicator. |
| FR-061 | The system shall notify targeted members when a post is published. |

### 6.10 Membership & Payments

| ID | Requirement |
|---|---|
| FR-062 | The system shall offer four membership types priced in AUD: Full Member ($45/month), Student ($32/month), Family ($70/month, covering up to 4 family members), and Casual ($15 per session). |
| FR-063 | The system shall charge monthly membership fees automatically on the member's billing date via Stripe. |
| FR-064 | The system shall allow a Casual member to purchase a prepaid session pack via Stripe at $15 AUD per session, display their remaining session balance, and decrement the balance by one for each session attended (attendance saved as Present or Late). |
| FR-065 | The system shall display to a member their current plan, its status (e.g., Active), price, next charge date, and payment method (card brand and last four digits). |
| FR-066 | The system shall allow a member to change their membership type, with the change taking effect at the start of the next billing cycle (no mid-cycle pro-rata adjustments). |
| FR-067 | The system shall allow a member to update their payment card through Stripe without the platform storing card data. |
| FR-068 | The system shall display a member's payment history with date, description, amount, and status. |
| FR-069 | The system shall retrieve the club's active one-off charge items (e.g., competition levies) from Stripe, display them to members as payable items, process payment via Stripe, and record the charge in the member's payment history. One-off items are created and managed by Admin or Committee users directly in Stripe. |
| FR-070 | The system shall display a prominent alert to a member whose last payment failed, including the failure date and an action to retry the payment. |
| FR-071 | The system shall allow the member to retry a failed payment and shall update the membership status upon success. |
| FR-072 | The system shall notify a member before their membership renewal charge, including the amount and payment method. |
| FR-080 | The system shall allow an Admin or Committee member to configure the session-pack options offered to Casual members (the number of sessions per pack). |

### 6.11 Notifications

| ID | Requirement |
|---|---|
| FR-073 | The system shall provide an in-app notification centre listing the user's notifications with title, body, and relative timestamp, newest first. |
| FR-074 | The system shall display an unread-count badge on the notification entry point whenever unread notifications exist. |
| FR-075 | The system shall visually distinguish unread notifications and allow the user to mark all notifications as read in one action. |

### 6.12 Dashboard, Search & Presentation

| ID | Requirement |
|---|---|
| FR-076 | The system shall display a dashboard with: club attendance rate over the last 30 days, active member count, time until the next training session, and the user's unread news count. |
| FR-077 | The system shall display the next 3 upcoming events and the 3 latest news posts on the dashboard, each linking to its full view. |
| FR-078 | The system shall provide a global search across members, events, and news from the top navigation bar. |
| FR-079 | The system shall allow the user to switch between a light and a dark visual theme, persisting the preference. |

---

## 7. User Stories

**Authentication & roles**
- As a **prospective member**, I want to create an account and pick my membership type in one flow, so that I can join the club in under a minute.
- As a **player**, I want to sign in with Google or Apple, so that I don't manage another password.
- As a **player**, I want to request Coach or Committee access with a short justification, so that an Admin can grant it without chasing me for context.
- As an **admin**, I want to review and approve role requests, so that elevated access stays controlled.

**Directory & groups**
- As an **admin**, I want to add a member with their AUF number and expiry, so that federation registration stays traceable (BR-008).
- As a **committee member**, I want to organise members into groups like "Senior Squad" or "Junior Squad", so that I can target events and news precisely.
- As any **member**, I want to search and filter the directory, so that I can find a teammate quickly.

**Events & attendance**
- As a **committee member**, I want to create a weekly recurring training with selected weekdays and an end date, so that the whole winter schedule is published in one action.
- As a **player**, I want to RSVP Yes/Maybe/No and change it later, so that coaches know real numbers.
- As a **coach**, I want to mark Present/Late/Absent against the roster during a session with everyone defaulting to Present, so that recording takes seconds.

**Teams & evaluations**
- As a **coach**, I want to auto-balance Saturday's scrimmage into two even teams with position coverage, so that games are competitive.
- As a **coach**, I want a suggested swap when the sides are uneven, so that I can fine-tune quickly.
- As a **player**, I want to see which team I'm on and my squad's lineup, so that I arrive prepared (bib colour, teammates).
- As a **coach**, I want to rate a player across ten skills and see the computed overall, so that development is tracked objectively and privately.

**News & payments**
- As a **committee member**, I want to publish a document with a PDF attached to selected groups, so that policy updates reach the right people.
- As a **player**, I want my $45 monthly fee charged automatically and a reminder before each renewal, so that my membership never lapses by accident.
- As a **player with a declined card**, I want a clear alert and a one-click retry, so that I can fix it immediately.
- As the **committee**, we want failed payments surfaced and recoverable, so that club revenue is predictable (BR-005).

---

## 8. Acceptance Criteria

### Authentication & Accounts
- **AC-001** *(FR-001, FR-008, FR-009)* — Given a visitor on the sign-up form, When they submit a valid full name, email, password, and a selected membership type, Then the system shall create the account with the Player role and the chosen membership type.
- **AC-002** *(FR-002)* — Given a user creating or resetting a password, When they submit a password of 7 or fewer characters, Then the system shall reject it and state the 8-character minimum.
- **AC-003** *(FR-003, FR-007)* — Given a registered user, When they submit valid credentials, Then the system shall grant access; When they sign out, Then the system shall end the session and return them to the sign-in screen.
- **AC-004** *(FR-004, FR-005)* — Given a visitor choosing Google or Apple sign-in, When the provider authenticates them successfully, Then the system shall sign them in (creating a Player account on first use).
- **AC-005** *(FR-006)* — Given a registered email address, When a password reset is requested, Then the system shall send a reset link to that address and confirm the send to the user.
- **AC-006** *(FR-010, FR-011)* — Given a signed-up user submitting a role request for Coach, When an Admin approves it, Then the user's role shall change to Coach; When an Admin rejects it, Then the role shall remain Player.

### Access Control
- **AC-007** *(FR-013)* — Given a signed-in Player, When they attempt to access team builder, attendance, evaluations, user administration, or publishing — via navigation or direct request — Then the system shall deny access.
- **AC-008** *(FR-014)* — Given an Admin viewing a member's profile, When they change the member's role to Committee, Then the member's permissions shall reflect the Committee matrix immediately.

### Directory & Groups
- **AC-009** *(FR-015, FR-016)* — Given a signed-in Player viewing the directory, Then the OVR column shall not be present; Given an Admin or Coach, Then the OVR column shall be present.
- **AC-010** *(FR-017, FR-018, FR-019)* — Given the directory with the role filter set to "Coach" and sort set to attendance descending, Then only Coach members shall be listed, ordered by attendance percentage from highest to lowest.
- **AC-011** *(FR-020, FR-021)* — Given an Admin submitting the Add Member form with all required fields including AUF number and expiry, Then the system shall create the member as a Player, assign the selected groups, and send an email invitation.
- **AC-012** *(FR-023, FR-024, FR-025)* — Given an authorised user, When they create a group named "Masters Squad", Then it shall appear in the group list with a member count of 0; When they delete it, Then it shall no longer be offered as an audience target.

### Events, RSVP & Attendance
- **AC-013** *(FR-028, FR-037)* — Given a Committee member creating a one-time Competition event targeted to "Senior Squad", When they save it, Then the event shall appear only in Senior Squad members' calendars and each of those members shall receive a notification.
- **AC-014** *(FR-030, FR-031)* — Given a weekly recurring Training event on Tuesdays and Thursdays from 1 July to 31 August, When it is created, Then one event occurrence shall exist for every Tuesday and Thursday in that range.
- **AC-015** *(FR-034, FR-035, FR-036)* — Given a targeted member viewing an event, When they select "Maybe" and later change to "Yes" before the event starts, Then the stored RSVP shall be "Yes" and the event's aggregate counts shall update accordingly.
- **AC-016** *(FR-038, FR-039, FR-040, FR-041)* — Given a Coach opening attendance for a session, Then every rostered member shall default to Present; When the Coach marks two members Late and one Absent and saves, Then the summary shall read the correct counts, the records shall persist, and a save confirmation shall be shown.
- **AC-017** *(FR-042)* — Given a member with 9 Present/Late records out of 10 sessions, Then their displayed attendance shall be 90%.

### Team Builder & Evaluations
- **AC-018** *(FR-044, FR-045)* — Given manual mode with players in the available pool, When the builder assigns a player to Team Kelp, Then the player shall leave the pool, appear in Team Kelp, and both teams' totals and the point difference shall update immediately.
- **AC-019** *(FR-046)* — Given a 12-player squad with evaluations, When auto-balance runs, Then each team shall receive 6 players, the combined-score difference shall be no greater than the smallest achievable by moving any single player, and each team shall include at least one goalkeeper where the squad contains two or more.
- **AC-020** *(FR-048, FR-049)* — Given a player assigned to Team Kelp for Saturday's scrimmage, Then the player shall receive a team-assignment notification and shall be able to view their team name and full lineup.
- **AC-021** *(FR-050, FR-051, FR-052)* — Given the default ten-category configuration and a Coach starting a new evaluation, Then all ten categories shall initialise at 5; When the Coach sets ratings summing to 83 and saves, Then the player's OVR shall display as 8.3.
- **AC-022** *(FR-050)* — Given a Coach adjusting a rating at 10 (or 1), When they attempt to increase (or decrease) it further, Then the rating shall remain within 1–10.
- **AC-023** *(FR-055, FR-056)* — Given a Player viewing their own profile, Then no category ratings or OVR shall be shown, and a notice shall state ratings are visible to coaching staff only.

### News & Documents
- **AC-024** *(FR-057, FR-058, FR-059, FR-060, FR-061)* — Given a Committee member publishing a Document post with a PDF attached, targeted to "All members", When they publish, Then the post shall appear at the top of every member's feed with an attachment indicator, and members shall receive a notification.

### Payments
- **AC-025** *(FR-062, FR-063, FR-065)* — Given a Full member with an active card, When their monthly billing date arrives, Then Stripe shall charge $45.00 AUD and the member's plan panel shall show status Active with the next charge date.
- **AC-026** *(FR-068)* — Given a member with past charges including a one-off levy, When they open payment history, Then each row shall show date, description, amount, and status.
- **AC-027** *(FR-070, FR-071)* — Given a member whose last charge was declined, Then a failed-payment alert with the decline date and a Retry action shall be displayed; When the retry succeeds, Then the alert shall clear and the membership shall show Active.
- **AC-028** *(FR-072)* — Given a membership renewing on 1 July, Then the member shall receive a renewal-reminder notification before that date stating the amount and card.
- **AC-029** *(FR-067)* — Given a member updating their card, When the update completes, Then the new card's brand and last four digits shall display, and no full card number shall exist in the platform's data stores.

### Notifications, Dashboard & Presentation
- **AC-030** *(FR-073, FR-074, FR-075)* — Given a user with 3 unread notifications, Then the badge shall show 3; When they select "Mark all read", Then the badge shall disappear and no notification shall render as unread.
- **AC-031** *(FR-076, FR-077)* — Given a signed-in user opening the dashboard, Then the four statistics tiles, the next 3 upcoming events, and the 3 latest news posts shall be displayed.
- **AC-032** *(FR-078)* — Given a user searching "Geelong", Then matching events (e.g., the Geelong scrimmage) and matching news posts shall be returned, grouped by type.
- **AC-033** *(FR-079)* — Given a user switching to dark theme, When they sign in again later, Then the interface shall render in dark theme.

### Review resolutions (v1.1)
- **AC-034** *(FR-064, FR-080)* — Given an Admin has configured a 10-session pack, When a Casual member purchases it, Then Stripe shall charge $150.00 AUD, the member's balance shall show 10 sessions, and after attendance for a session is saved with the member marked Present or Late, the balance shall show 9.
- **AC-035** *(FR-053, FR-052)* — Given a Coach adds an eleventh skill category "Breath control", When a new evaluation is created, Then it shall present eleven categories initialised at 5 and compute OVR as the mean of all eleven ratings; evaluations saved before the change shall retain their original categories and OVR.
- **AC-037** *(FR-069, INT-007)* — Given an Admin has created an active one-off product "Nationals levy — $80" in Stripe, When a member opens the payments area, Then the levy shall be listed as payable; When the member pays it, Then Stripe shall charge $80.00 AUD and the charge shall appear in the member's payment history; archived/inactive Stripe products shall not be listed.
- **AC-036** *(FR-081, FR-082)* — Given a registrant whose date of birth makes them 16, When they attempt to complete sign-up without guardian consent, Then the account shall not be activated; When guardian name, email, and consent are recorded, Then the account shall activate.

---

## 9. Data Requirements

Key entities and their principal attributes. Attribute lists are requirements-level, not schema design.

| Entity | Key attributes | Relationships |
|---|---|---|
| **Member** | Full name, email, date of birth, role, position (Goalkeeper/Defender/Forward), experience level (Beginner/Intermediate/Advanced), gender, country, AUF number, AUF expiry date, join date, status; for members under 18: guardian name, guardian email, consent record (timestamp) | Belongs to many Groups; has one Membership; has many RSVPs, AttendanceRecords, Evaluations, Payments, Notifications |
| **Group** | Name, member count (derived) | Has many Members; targeted by Events and Posts |
| **Event** | Title, type (Training/Competition/Meeting/Social), date, time, location, notes, audience (all/groups), recurrence (none or weekly: days, start, end), parent series (for occurrences) | Targeted at Groups; has many RSVPs; has at most one TeamSplit; has one AttendanceSheet (Training) |
| **RSVP** | Response (Yes/Maybe/No), responded at | One per Member per Event (latest wins) |
| **AttendanceRecord** | Status (Present/Late/Absent), session reference, recorded by, recorded at | One per Member per session |
| **Evaluation** | One 1–10 integer rating per configured category, evaluated by, updated at; OVR (derived) | A single current evaluation per Member, edited in place (no per-season versioning); references the category set in force when saved |
| **SkillCategoryConfig** | Active skill categories (name, active flag, order), updated by, updated at; default: the ten categories in FR-050 | Maintained by Admin/Coach; referenced by Evaluations |
| **SessionPackOption** | Sessions per pack, derived price (sessions × $15 AUD), active flag | Maintained by Admin/Committee; purchasable by Casual members |
| **TeamSplit** | Event reference, two team names, mode (manual/auto) | Has two Teams, each with assigned Members |
| **Post** | Category (Announcement/News/Document), title, body, author, published at, audience (all/groups) | Has many Attachments (PDF/document/image) |
| **Membership** | Type (Full/Student/Family/Casual), status, price, billing date, payment method reference (tokenised), prepaid session balance (Casual) | One per Member (Family: covers up to 4 linked Members — [TBD]: linking model) |
| **Payment** | Date, description, amount, currency (AUD), status, external (Stripe) reference | Belongs to a Member |
| **Notification** | Type, title, body, created at, read flag | Belongs to a Member |
| **RoleRequest** | Requested role (Coach/Committee), justification, status, decided by, decided at | Belongs to a Member |

**Retention & ownership.** Member personal data is owned by the club as data controller. Attendance, evaluation, and payment history shall be retained while the member is active; retention period after departure is [TBD] (recommendation: define before go-live to satisfy APP 11). No cardholder data is stored in the platform (see NFR-006).

---

## 10. Integration Requirements

| ID | System | Description |
|---|---|---|
| INT-001 | Stripe | The system shall create and manage recurring subscriptions (Full/Student/Family) and per-session charges (Casual) through Stripe, in AUD. |
| INT-002 | Stripe | The system shall receive and process payment outcome events from Stripe (success, failure) and update membership status and payment history accordingly. |
| INT-003 | Stripe | Card capture and update shall occur through Stripe-hosted/tokenised mechanisms so that card data never transits or rests in the platform. |
| INT-004 | Google Identity | The system shall support OAuth sign-in/sign-up with Google accounts. |
| INT-005 | Apple ID | The system shall support Sign in with Apple. |
| INT-006 | Email provider | The system shall send transactional emails: member invitations, password reset links, and payment/renewal notices. |
| INT-007 | Stripe | The system shall retrieve the club's active one-off products/prices from Stripe to present payable items (levies, fees) to members (supports FR-069). |

| System | Interface | Protocol | Direction | Frequency |
|---|---|---|---|---|
| Stripe | REST API + webhooks | HTTPS | Bidirectional | On event |
| Google Identity | OAuth 2.0 / OIDC | HTTPS | Outbound | On sign-in |
| Apple ID | OAuth 2.0 / OIDC | HTTPS | Outbound | On sign-in |
| Email provider | API or SMTP | HTTPS/TLS | Outbound | On event |

---

## 11. Non-Functional Requirements

### Performance
- **NFR-001** — The system shall complete 95% of user-facing API requests and page interactions within 1 second under normal operating load (up to 50 concurrent users).
- **NFR-002** — The system shall complete auto-balance team generation for a squad of up to 30 players within 2 seconds at the 95th percentile.

### Availability
- **NFR-003** — The system shall target 99.0% monthly availability on a best-effort basis, with no contractual SLA. Planned maintenance shall be scheduled outside club training hours (Tue/Thu 18:00–22:00 and Sat 08:00–13:00 AEST/AEDT) and announced via the news feed at least 48 hours in advance.

### Security
- **NFR-004** — The system shall require authentication for all functionality except sign-up, sign-in, and password reset, and shall enforce the Section 4 permission matrix on the server for 100% of requests.
- **NFR-005** — The system shall store passwords only as salted one-way hashes using a current industry-standard algorithm, and shall transmit all traffic over TLS 1.2 or higher.
- **NFR-006** — The system shall store no primary account numbers (PANs) or card security codes; only tokenised payment references and card metadata (brand, last four digits, expiry) may be persisted, keeping the platform within Stripe's minimal PCI DSS scope.
- **NFR-007** — The system shall invalidate a password reset link after first use or after 60 minutes, whichever comes first.

### Scalability
- **NFR-008** — The system shall support at least 500 member records, 5,000 event occurrences, and 50,000 attendance records without exceeding the NFR-001 response target.
- **NFR-009** — All club data shall be logically scoped to a single club identifier so that future multi-club operation (see CON-004) does not require restructuring existing records.

### Maintainability & Observability
- **NFR-010** — The system shall log all authentication events, role changes, and payment state changes with actor, timestamp, and outcome, retained for at least 12 months.
- *(Recommendation, not a requirement)* — Add an admin-visible audit view over NFR-010 logs in a later release.

### Compliance
- **NFR-011** — The system shall handle personal information in accordance with the Australian Privacy Act 1988 (Australian Privacy Principles), including a published privacy notice at sign-up and a mechanism to fulfil member data access/deletion requests within 30 days.
- **NFR-012** — Where a registrant's or member's date of birth indicates they are under 18, the system shall capture parent/guardian name, email, and explicit consent during registration (FR-081, FR-082) and shall not process the minor's personal data in an active account until consent is recorded.

---

## 12. Assumptions

| ID | Assumption |
|---|---|
| ASS-001 | All prices are in AUD and the prototyped amounts (Full $45/mo, Student $32/mo, Family $70/mo, Casual $15/session, example levy $80) are the amounts the committee intends to charge at launch. |
| ASS-002 | The club operates as a single tenant at launch; "Victoria Seadragons" branding is fixed in Release 1. |
| ASS-003 | AUF registration is managed externally by the federation; the platform only records each member's AUF number and expiry date (no AUF system integration). |
| ASS-004 | Members have internet access and a modern evergreen browser; Release 1 targets responsive web on viewports from 360 px wide. |
| ASS-005 | Email is a reliable delivery channel for invitations, resets, and payment notices; no SMS channel in Release 1. |
| ASS-006 | *Resolved in v1.1:* Coaches cannot create events of any kind. Event creation is restricted to Admin and Committee (Section 4 matrix, FR-028, FR-030). |
| ASS-007 | *Resolved in v1.1:* Casual membership is prepaid. Members purchase session packs whose sizes are configurable by Admin/Committee (FR-080) at $15 AUD per session (FR-064); the balance decrements per attended session. Pack price is exactly sessions × $15 AUD — no volume discounts of any kind (*confirmed in v1.3*). |
| ASS-008 | *Resolved in v1.2:* no per-season evaluation history or versioning is required. Each member has a single current evaluation that Admin/Coach edit in place. |
| ASS-009 | *Resolved in v1.2:* the dashboard "Export" control shown in the prototype is removed from scope entirely (see Section 3.2). |
| ASS-010 | Month and week calendar views shown as toggles in the prototype are visual variants deferred beyond Release 1; the agenda list (the prototype's active view) is the Release 1 requirement. |

---

## 13. Constraints

| ID | Constraint |
|---|---|
| CON-001 | Release 1 is a responsive web application; no native mobile app is delivered in Release 1. |
| CON-002 | Release 2 will deliver a React Native mobile app whose scope is the prototype's mobile views (Home, Notifications, Calendar, Team, News, Profile); Release 1 decisions must not preclude it (e.g., all functionality available via APIs). |
| CON-003 | Stripe is the sole payment provider in Release 1; PayPal is explicitly out of scope. |
| CON-004 | The solution must not preclude future multi-club (multi-tenant) operation (see NFR-009). |
| CON-005 | Billing currency is AUD. |
| CON-006 | The platform must comply with the Australian Privacy Act 1988 as a condition of processing member data (see NFR-011). |

---

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Prepaid session balances drift from actual attendance | Casual members over- or under-charged; trust impact | FR-064 ties decrement strictly to saved attendance (Present/Late); balance always visible to the member; Stripe receipts per pack purchase |
| Failed payments not recovered | Revenue leakage (BR-005 unmet) | FR-070/FR-071 alerts and retry; renewal reminders (FR-072); monitor Stripe failure webhooks (INT-002) |
| Evaluation data leaks to players | Privacy breach, club conflict, loss of coach candour | Server-side enforcement (NFR-004), FR-055 tested explicitly (AC-023), access logging (NFR-010) |
| Minors' data handled without consent | Privacy Act breach, reputational damage | FR-081/FR-082 capture DOB and guardian consent at registration; NFR-012 blocks activation until consent recorded |
| Skill-category changes mid-season reduce OVR comparability | Team balancing and development tracking distorted across periods | FR-053 applies changes prospectively only; recommend changing categories at season boundaries |
| Auto-balance produces unfair teams for small/odd squads | Coaches abandon the feature | FR-046 position-coverage rule; FR-047 swap suggestion; manual mode always available |
| Single-club design hard-coded | Costly rework if the platform becomes multi-club SaaS | NFR-009 club-scoped data from day one |
| One-off items managed directly in Stripe drift from club intent (stale or mislabeled levies) | Members see expired or incorrect payable items | INT-007 lists only *active* Stripe products; committee process to archive items once collection closes |
| Notification fatigue (every event/news notifies) | Members ignore notifications | Committee guidance on targeting via groups (FR-027); per-user notification preferences as a later enhancement |

---

## 15. Traceability Matrix

| BR | FR | Acceptance Criteria |
|---|---|---|
| BR-001 | FR-001–FR-014, FR-015–FR-022, FR-023–FR-027, FR-076–FR-079 | AC-001–AC-012, AC-031–AC-033 |
| BR-002 | FR-028–FR-037, FR-038–FR-042 | AC-013–AC-017 |
| BR-003 | FR-043–FR-049 | AC-018–AC-020 |
| BR-004 | FR-050–FR-054 | AC-021, AC-022, AC-035 |
| BR-005 | FR-062–FR-072, FR-080 (with INT-001–INT-003, INT-007) | AC-025–AC-029, AC-034, AC-037 |
| BR-006 | FR-037, FR-049, FR-057–FR-061, FR-073–FR-075 | AC-013, AC-020, AC-024, AC-030 |
| BR-007 | FR-012–FR-014, FR-016, FR-055, FR-056, FR-081, FR-082 | AC-007–AC-009, AC-023, AC-036 |
| BR-008 | FR-020 (AUF fields) | AC-011 |

**Orphan check:** every FR above maps to at least one BR and is covered by at least one AC; every NFR carries a number, unit, and condition. Open item remaining: data retention after member departure (Section 9) — a committee policy decision (APP 11), not a build blocker. Resolved in v1.1: casual billing model, coach event permissions, position-score weightings (replaced by configurable categories), minor-consent flow. Resolved in v1.2: plan changes take effect next cycle (FR-066), one-off charges are Stripe-managed and member-payable (FR-069, INT-007, AC-037), no evaluation versioning (ASS-008), dashboard export removed (ASS-009). Resolved in v1.3: pack pricing is strictly sessions × $15, no discounts (ASS-007).

---
*End of document.*
