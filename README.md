# Prompt Playground - Legal Brief Analysis

A frontend-only prompting playground for testing and refining Gemini prompts for legal brief comparison. Designed for teams to experiment with prompt engineering without needing backend infrastructure.

## Features

- **Editable System Prompt**: Modify the prompt template in real-time
- **Prompt Preview**: See exactly what gets sent to Gemini before running
- **Multiple Models**: Choose between Gemini 1.5 Flash, 1.5 Pro, 2.0 Flash, etc.
- **Structured Output**: Parses JSON responses and displays them nicely
- **Raw Response View**: Always see the raw API response for debugging
- **Pre-configured API Key**: Set once in GitHub Secrets, works for all users

## Deployment to GitHub Pages

### Step 1: Add Your Gemini API Key to GitHub Secrets

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Set the name to: `GEMINI_API_KEY`
5. Paste your Gemini API key as the value
6. Click **Add secret**

![GitHub Secrets Location](https://docs.github.com/assets/cb-28266/images/help/repository/repo-settings-secrets-and-variables.png)

### Step 2: Enable GitHub Pages

1. Still in repository **Settings**, go to **Pages**
2. Under "Build and deployment", set **Source** to **"GitHub Actions"**

### Step 3: Push to Main

```bash
git add .
git commit -m "Deploy prompt playground"
git push origin main
```

GitHub Actions will automatically:
- Build the frontend with your API key embedded
- Deploy to GitHub Pages

Your site will be available at:
```
https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/
```

### Step 4: Share with Your Team

Just share the URL! The API key is already configured, so your team can immediately start experimenting with prompts.

## Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key

## Security Note

Since GitHub Pages serves static files, the API key gets embedded in the JavaScript bundle during build. This means:

- Anyone who can access your site URL can technically extract the key from network requests
- **For internal team use**, this is usually acceptable
- **For public access**, consider using API key restrictions in Google Cloud Console:
  - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  - Click on your API key
  - Under "Application restrictions", select "HTTP referrers"
  - Add your GitHub Pages URL (e.g., `https://yourname.github.io/*`)

This ensures the key only works when called from your specific domain.

## Local Development

```bash
cd frontend
bun install
bun run dev
```

Then open http://localhost:3000

For local development with an API key, create a `.env` file in the `frontend` folder:
```
VITE_GEMINI_API_KEY=your_api_key_here
```

## How It Works

1. **API key is pre-configured** - Set via GitHub Secrets during deployment
2. **Edit the system prompt** - Use `{{BRIEF_A}}` and `{{BRIEF_B}}` as placeholders
3. **Paste your briefs** - Add content to Brief A and Brief B
4. **Preview** - Check the "Prompt Preview" tab to see the full prompt
5. **Run Analysis** - Calls Gemini directly from the browser
6. **View Results** - See both raw and parsed responses

## Prompt Template Variables

The system prompt supports these placeholders:
- `{{BRIEF_A}}` - Replaced with Brief A content
- `{{BRIEF_B}}` - Replaced with Brief B content

## Updating the API Key

To rotate or change the API key:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click on `GEMINI_API_KEY`
3. Click **Update secret**
4. Enter the new key
5. Go to **Actions** tab and re-run the latest deployment (or push any change)
