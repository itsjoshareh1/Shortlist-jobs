# Shortlist

Paste your resume and get live job postings ranked by how well they fit you.

Shortlist pulls open roles from five free job board feeds, scores each posting against your resume and target title, and shows the best matches with the skills that matched and a link to apply. Add an Anthropic API key and Claude re-ranks the top matches and explains each fit in one sentence.

## Features

- **Resume in, jobs out.** Paste your resume or upload a PDF or `.txt` file.
- **Live postings** from [Remotive](https://remotive.com), [Remote OK](https://remoteok.com), [Jobicy](https://jobicy.com), [The Muse](https://www.themuse.com) and [Arbeitnow](https://www.arbeitnow.com).
- **Fit score (0–100)** for every posting, with the resume skills it matched.
- **Filters** for seniority, remote/hybrid/on-site, location and minimum fit.
- **Optional Claude ranking**, which re-scores the top 25 postings and says why each one fits or where the gap is.
- **Application tracker:** Saved → Applied → Interview → Offer → Closed, stored in your browser.
- **No dependencies.** One Node file and one HTML file.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/<your-username>/shortlist-jobs.git
cd shortlist-jobs
npm start
```

Open http://localhost:4317.

### Run the tests

```bash
npm test
```

### Turn on Claude ranking (optional)

```bash
cp .env.example .env
# then set ANTHROPIC_API_KEY in .env
npm start
```

Without a key, Shortlist uses its built-in keyword ranking, which needs no account.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Turns on Claude ranking of the top 25 matches |
| `SHORTLIST_MODEL` | `claude-sonnet-5-5` | Claude model used for ranking |
| `PORT` | `4317` | Port for the local server |

Set these in `.env` or as environment variables.

## How ranking works

1. **Search.** Builds search terms from your target role and resume, then queries every source in parallel. Postings older than 120 days are dropped, and duplicates across boards are merged.
2. **Score.** Compares each posting to your resume using TF-IDF cosine similarity (unigrams and bigrams, with the job title weighted highest). It then adjusts for:
   - how closely the job title matches your target role
   - seniority mismatch (for example, senior roles when you chose Entry)
   - work style and location
   - posting age
3. **Re-rank (optional).** Sends the top 25 postings and your resume to Claude, which returns a strict 0–100 score and a one-line reason for each.

## Project structure

```
shortlist-jobs/
├── server.js          # HTTP server, job board fetchers, ranking, Claude re-ranking
├── public/index.html  # The whole interface (vanilla JS, PDF parsing via pdf.js)
├── test/rank.test.js  # Ranking tests (no network)
├── .env.example       # Optional settings
└── package.json
```

## API

`POST /api/search`

```json
{
  "role": "Senior Software Engineer",
  "level": "Senior",
  "mode": "Remote",
  "location": "",
  "salary": "$150k",
  "resume": "Backend engineer, 6 years. Python, Go, PostgreSQL..."
}
```

Returns `{ jobs: [...], total, sources, ai, aiError, query }`. Each job has `title`, `company`, `location`, `url`, `source`, `posted`, `salary`, `score`, `matched`, `snippet` and, when Claude ranking is on, `reason`.

## Limitations

- **Mostly remote jobs.** Most of the free feeds list remote roles only, and Arbeitnow is mostly Europe. Local US on-site coverage comes only from The Muse.
- **No LinkedIn or Indeed.** Neither offers a free public jobs API.
- **Local only.** Your resume goes to your own local server and, if you turn on Claude ranking, to the Anthropic API. Nothing else is stored server-side.

## Credits

Job data comes from Remotive, Remote OK, Jobicy, The Muse and Arbeitnow. Their API terms ask that listings link back to the original posting, which every result does. If you deploy this publicly, check each provider's terms first.

## License

[MIT](LICENSE)
