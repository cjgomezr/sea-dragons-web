# Training v1: Excel template

## How it's generated
- The server generates the workbook on every download, with **exceljs**. SheetJS community can't write data validation or sheet protection, so it won't work here.
- Each download includes **the club's current exercises, marks and routines**. Exercises created after a download need a fresh download; when the library has changed since the user's last download, the panel shows "The library changed since your last download".
- **Two downloads**:
  - **Empty template** for a new cycle;
  - **Current cycle as Excel**, pre-filled with the selected cycle's routines and calendar.
- File name: `training-{club-slug}-{cycle-slug|new}-{YYYY-MM-DD}.xlsx`.

## Style
- Header row: bold, light grey fill, frozen.
- Editable cells: white, unlocked.
- Locked cells: light grey fill.
- Every sheet is protected (no password, or a known one): only unlocked cells can be edited, and select-locked-cells is allowed.
- Column widths are set, and so is the print area.

## Sheets

### 1. `Instructions` (locked)
- Numbered steps, in the club's language:
  1. Fill **Cycle** (3 white cells).
  2. Write your routines in **Routines**, one row per exercise.
  3. Pick a routine for each day in **Calendar**.
  4. Save and upload the file in Training › Cycle › Upload.
- A filled example block (greyed out) showing 2 routines.
- A note: "White cells only. Don't rename or reorder the sheets."

### 2. `Cycle`
| Cell | Field | Validation |
| --- | --- | --- |
| B2 | Cycle name | Text, 1–80 characters. **Required.** |
| B3 | Event first day | Date. If empty, B4 is required. |
| B4 | Start date (Monday) | Date. Used only when B3 is empty. |
| B5 | Weeks | Whole number, 1–52. **Required.** |
| B6 | Target event name | Text, optional. |

- A1–A6 are labels (locked).
- B8 (locked) holds a formula: "Week 1 starts {date} · ends {date}".

### 3. `Routines`
One row per exercise, as a table with these columns:

| Col | Header | Validation |
| --- | --- | --- |
| A | Routine | Text, **required**. Rows with the same name make one routine, in row order. |
| B | Exercise | **List** from `Exercises!A:A`, required. If a name isn't on the list, the import offers to create it. |
| C | Sets | Whole number, 1–99, optional. |
| D | Reps / distance | Text, optional ("8", "max", "50 m"). |
| E | Rest | Text, optional ("1:30"). |
| F | Load | **List**: `No load`, `% of {Mark 1}`, `% of {Mark 2}`, …, `Text`. |
| G | Load value | A number from 1 to 150 when F is "% of…"; text when F is `Text`; empty when F is `No load`. |
| H | Note | Text, optional. |
| I | Shared? | **List**: `No`, `Yes`. Default `No`. "Yes" creates a shared routine. |

- Prepare 300 rows with validation. Header row 1 is locked and frozen.
- When downloading the current cycle, existing routines are pre-filled.

### 4. `Calendar`
- Rows = weeks, columns = Mon–Sun.
- A: week number (locked). B: the week's dates as "4 Nov – 10 Nov" (locked; a formula from `Cycle`).
- C–I: Mon to Sun (unlocked). Each cell is a **list** of `Rest` plus the unique names in `Routines!A:A` (through a hidden helper column `Lists!A:A` built by formula, or written by the server for the pre-filled version).
- Prepare 52 rows; rows beyond `Cycle!B5` are greyed out with conditional formatting and ignored on import.
- Conditional formatting colours each routine cell (optional).

### 5. `Exercises` (hidden, locked)
- A: exercise name (the library plus the club's own, sorted).
- B: source (`Library` or `Club`).

### 6. `Lists` (hidden, locked)
- Helper lists: mark names (for column F) and routine names (for the Calendar).

## Import (`import_training_template`)
1. Upload the `.xlsx` (5 MB maximum).
2. The server parses it, validates every rule above, and builds a **preview**. Nothing is written yet.
3. The **review screen** (a modal in the app) shows:
   - **Summary**: "{n} new routines · {N} weeks · {d} planned days · {e} new club exercises".
   - **Errors** (red, block the import), each with sheet, row and column. For example: "Routines row 14: Load value must be a number for "% of Back squat"."; "Calendar W3 Tue: "Gym C" isn't in Routines."; "Cycle B5: Weeks must be 1–52.".
   - **Warnings** (amber, don't block). For example: "Exercise "Turn and push-off" isn't in the library. It will be created as a club exercise."; "Routine "Mobility" already exists as shared. It will be reused, not duplicated.".
   - Two actions: **Import as draft** (the default) and **Import and make active**.
4. Writing happens in one transaction: create the cycle (as a draft), the routines (this cycle's, or shared when "Shared? = Yes"), the items, the days and the new club exercises.
5. **Matching**:
   - **Exercises**: by normalized name (case- and accent-insensitive).
   - **Marks**: by the name after "% of " (normalized). An unknown mark is an error, so the template's list prevents it.
   - **Routines**: new names are created. When importing into an **existing** cycle (from "Current cycle as Excel"), the import updates that cycle's routines with the same name and replaces their items and its days.
6. Write an `audit_log` row with the counts.
