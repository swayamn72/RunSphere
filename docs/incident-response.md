# Personal-data breach response plan

> M8 C.5. Draft for owner and legal review (C.7). The DPDP Rules 2025 obligations on breach
> notification apply from about May 2027, but this plan should be in use from launch. Check the
> exact deadlines against the notified Rules with your lawyer.

A **personal-data breach** is any unauthorised processing, disclosure, loss of access to, or
destruction of personal data RunSphere holds: for example a leaked database dump, an exposed
backup, a staff account misused, an API bug that shows one runner's data to another, or a lost
laptop with a copy of production data.

## Roles

| Role              | Who                           | Does                                    |
| ----------------- | ----------------------------- | --------------------------------------- |
| Incident lead     | Owner (until named otherwise) | Runs the response, decides on notices   |
| Grievance officer | `GRIEVANCE_OFFICER_NAME`      | Handles questions from affected runners |
| Engineer on call  | Whoever is deploying          | Contains, investigates, fixes           |

## Steps

1. **Contain (first hour).** Stop the leak: revoke keys or tokens, rotate `AUTH_TOKEN_SECRET`
   (signs everyone out) and database credentials, take the affected route offline, remove public
   access to the exposed resource. Don't delete evidence.
2. **Record (start immediately).** Keep a timeline: when it started, when it was found, by whom,
   what was done. Save the relevant logs. Logs never contain coordinates or tokens, so they can be
   shared with investigators.
3. **Assess (within 24 hours).** Which data (location history, email, username, safety contacts),
   how many accounts, whether it was actually accessed, and the likely harm. Location history and
   safety-contact data are the most sensitive.
4. **Notify the Data Protection Board.** Without delay with a first report, and a detailed report
   (what happened, data and people affected, likely consequences, what was done, what's being done
   to prevent it, contact) **within 72 hours** of becoming aware, as the Rules require.
5. **Notify affected runners** without delay, in plain words, by email and in the app inbox: what
   happened, what data, what we've done, what they can do (change password, review safety
   contacts), and who to contact. Follow `docs/voice.md`.
6. **Fix and review.** Fix the cause, add a test that would have caught it, update
   `BUGS_AND_RISKS.md`, and write a short review within two weeks.

## Before launch

- [ ] Owner and lawyer have reviewed this plan.
- [ ] The incident lead knows how to rotate every secret listed in `.env.example`.
- [ ] Backups are encrypted and access to them is limited and logged.
- [ ] A template email to affected runners and a template report to the Board exist.
