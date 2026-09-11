# StartingBlocks form dump

Captured 2026-09-11T04:52:37.936Z from https://www.startingblocks.gov.au/child-care-subsidy-calculator

The calculator is a landing page, then ONE form page, then a results page —
not a multi-step wizard. Children are tabs: only the selected child's fields
exist in the DOM. Activity hours and days are both asked PER FORTNIGHT, and the
fee is asked as a DAILY rate.

## Landing page — Child Care Subsidy Calculator

| # | tag | type | value | button text | accessible name / question |
|---:|---|---|---|---|---|
| 0 | button | button |  | Resources |  |
| 1 | button | submit |  | Get started |  |
| 2 | button | button |  | What is the Child Care Subsidy |  |
| 3 | button | button |  | Who can receive the Child Care Subsidy |  |
| 4 | button | button |  | Eligibility and entitlement |  |
| 5 | button | button |  | 3 Day Guarantee |  |

## Form — single, one child (defaults as pre-filled) — Child Care Subsidy Calculator

| # | tag | type | value | button text | accessible name / question |
|---:|---|---|---|---|---|
| 0 | button | button |  | Resources | Please describe your family |
| 1 | button | button | single |  | Single |
| 2 | input | radio | single |  | Single |
| 3 | button | button | partnered |  | Partnered |
| 4 | input | radio | partnered |  | Partnered |
| 5 | button | button |  |  | Recognised participation hours info |
| 6 | button | button |  |  | Decrease hours of recognised participation |
| 7 | input | number | 76 |  | How many hours of recognised participation (such as work, study, training or volunteering) do you do per fortnight? |
| 8 | button | button |  |  | Increase hours of recognised participation |
| 9 | button | button |  |  | Estimated annual income info |
| 10 | input | text | 115,000 |  | What is your family's estimated annual income? |
| 11 | button | button |  | Child 1 | What is the age of your child? |
| 12 | button | button |  |  | Decrease child's age |
| 13 | input | number | 2 |  | What is the age of your child? |
| 14 | button | button |  |  | Increase child's age |
| 15 | button | button | centreBasedDayCare |  | Centre Based Care |
| 16 | input | radio | centreBasedDayCare |  | Centre Based Care |
| 17 | button | button | familyDayCare |  | Family Day Care |
| 18 | input | radio | familyDayCare |  | Family Day Care |
| 19 | button | button | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 20 | input | radio | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 21 | button | button | inHomeCare |  | In Home Care |
| 22 | input | radio | inHomeCare |  | In Home Care |
| 23 | button | button |  |  | In home care info |
| 24 | input | number | 120 |  | What is the daily rate charged by your service? |
| 25 | button | button | on |  | Use the national average for my type of service |
| 26 | input | checkbox | on |  | Use the national average for my type of service |
| 27 | input | number | 8 |  | How many hours are you charged per day on average? |
| 28 | button | button | on |  | Use the national average for my type of service |
| 29 | input | checkbox | on |  | Use the national average for my type of service |
| 30 | input | number | 7 |  | What is the average number of days your child will attend a service per fortnight? |
| 31 | button | button |  | Add another child | Add another child |
| 32 | button | submit |  | Back | Please describe your family |
| 33 | button | submit |  | Calculate subsidy | Please describe your family |

## Form — partnered (adds the partner participation field) — Child Care Subsidy Calculator

| # | tag | type | value | button text | accessible name / question |
|---:|---|---|---|---|---|
| 0 | button | button |  | Resources | Please describe your family |
| 1 | button | button | single |  | Single |
| 2 | input | radio | single |  | Single |
| 3 | button | button | partnered |  | Partnered |
| 4 | input | radio | partnered |  | Partnered |
| 5 | button | button |  |  | Recognised participation hours info |
| 6 | button | button |  |  | Decrease hours of recognised participation |
| 7 | input | number | 76 |  | How many hours of recognised participation (such as work, study, training or volunteering) do you do per fortnight? |
| 8 | button | button |  |  | Increase hours of recognised participation |
| 9 | button | button |  |  | Estimated annual income info |
| 10 | input | text | 115,000 |  | What is your family's estimated annual income? |
| 11 | button | button |  |  | Decrease hours of recognised participation for partner |
| 12 | input | number | 0 |  | How many hours of work or another recognised activity does your partner do per fortnight? |
| 13 | button | button |  |  | Increase hours of recognised participation for partner |
| 14 | button | button |  | Child 1 | What is the age of your child? |
| 15 | button | button |  |  | Decrease child's age |
| 16 | input | number | 2 |  | What is the age of your child? |
| 17 | button | button |  |  | Increase child's age |
| 18 | button | button | centreBasedDayCare |  | Centre Based Care |
| 19 | input | radio | centreBasedDayCare |  | Centre Based Care |
| 20 | button | button | familyDayCare |  | Family Day Care |
| 21 | input | radio | familyDayCare |  | Family Day Care |
| 22 | button | button | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 23 | input | radio | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 24 | button | button | inHomeCare |  | In Home Care |
| 25 | input | radio | inHomeCare |  | In Home Care |
| 26 | button | button |  |  | In home care info |
| 27 | input | number | 120 |  | What is the daily rate charged by your service? |
| 28 | button | button | on |  | Use the national average for my type of service |
| 29 | input | checkbox | on |  | Use the national average for my type of service |
| 30 | input | number | 8 |  | How many hours are you charged per day on average? |
| 31 | button | button | on |  | Use the national average for my type of service |
| 32 | input | checkbox | on |  | Use the national average for my type of service |
| 33 | input | number | 7 |  | What is the average number of days your child will attend a service per fortnight? |
| 34 | button | button |  | Add another child | Add another child |
| 35 | button | submit |  | Back | Please describe your family |
| 36 | button | submit |  | Calculate subsidy | Please describe your family |

## Form — two children (children are TABS; only the selected one renders) — Child Care Subsidy Calculator

| # | tag | type | value | button text | accessible name / question |
|---:|---|---|---|---|---|
| 0 | button | button |  | Resources | Please describe your family |
| 1 | button | button | single |  | Single |
| 2 | input | radio | single |  | Single |
| 3 | button | button | partnered |  | Partnered |
| 4 | input | radio | partnered |  | Partnered |
| 5 | button | button |  |  | Recognised participation hours info |
| 6 | button | button |  |  | Decrease hours of recognised participation |
| 7 | input | number | 76 |  | How many hours of recognised participation (such as work, study, training or volunteering) do you do per fortnight? |
| 8 | button | button |  |  | Increase hours of recognised participation |
| 9 | button | button |  |  | Estimated annual income info |
| 10 | input | text | 115,000 |  | What is your family's estimated annual income? |
| 11 | button | button |  |  | Decrease hours of recognised participation for partner |
| 12 | input | number | 0 |  | How many hours of work or another recognised activity does your partner do per fortnight? |
| 13 | button | button |  |  | Increase hours of recognised participation for partner |
| 14 | button | button |  | Child 1 | What is the age of your child? |
| 15 | button | button |  | Remove | Remove child 1 |
| 16 | button | button |  | Child 2 | What is the age of your child? |
| 17 | button | button |  | Remove | Remove child 2 |
| 18 | button | button |  |  | Decrease child's age |
| 19 | input | number | 2 |  | What is the age of your child? |
| 20 | button | button |  |  | Increase child's age |
| 21 | button | button | centreBasedDayCare |  | Centre Based Care |
| 22 | input | radio | centreBasedDayCare |  | Centre Based Care |
| 23 | button | button | familyDayCare |  | Family Day Care |
| 24 | input | radio | familyDayCare |  | Family Day Care |
| 25 | button | button | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 26 | input | radio | outsideSchoolHoursCare |  | Out Of School Hours Care |
| 27 | button | button | inHomeCare |  | In Home Care |
| 28 | input | radio | inHomeCare |  | In Home Care |
| 29 | button | button |  |  | In home care info |
| 30 | input | number | 120 |  | What is the daily rate charged by your service? |
| 31 | button | button | on |  | Use the national average for my type of service |
| 32 | input | checkbox | on |  | Use the national average for my type of service |
| 33 | input | number | 8 |  | How many hours are you charged per day on average? |
| 34 | button | button | on |  | Use the national average for my type of service |
| 35 | input | checkbox | on |  | Use the national average for my type of service |
| 36 | input | number | 7 |  | What is the average number of days your child will attend a service per fortnight? |
| 37 | button | button |  | Add another child | Add another child |
| 38 | button | submit |  | Back | Please describe your family |
| 39 | button | submit |  | Calculate subsidy | Please describe your family |

## Results — Child Care Subsidy Calculator

| # | tag | type | value | button text | accessible name / question |
|---:|---|---|---|---|---|
| 0 | button | button |  | Resources |  |
| 1 | button | button |  |  | More information about your family income |
| 2 | button | button |  |  | More information about how many hours of subsidised care you’re eligible for |
| 3 | button | button |  |  | More information about the number of children in your care, and their ages |
| 4 | button | button |  |  | More information about the hourly rate cap for your type of service |
| 5 | button | button |  |  | More information about your session length and days in care |
| 6 | button | button |  |  | More information about a standard 5% withholding amount |
| 7 | button | button |  | Full breakdown |  |
| 8 | button | button |  | Email my results |  |
| 9 | button | submit |  | Back |  |
| 10 | button | submit |  | Start Over |  |

## Results tables (rendered text)

```
table 0
Weekly | Fortnightly

What the Australian Government pays
$338.09 | $676.17

Withholding
$17.79 | $35.59

What you pay
$81.92 | $163.83
```

```
table 1
Weekly | Fortnightly

Your total service fee
$420.00 | $840.00

Your CCS Rate
85.00% | 85.00%

What the Australian Government pays
$338.09 | $676.17

Withholding
$17.79 | $35.59

What you pay
$81.92 | $163.83
```
