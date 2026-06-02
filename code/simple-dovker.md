# Deploy a Node.js App to GCP Cloud Run with GitHub Actions

A simple, beginner-friendly guide to deploying a Node.js app to Google Cloud Run using GitHub Actions.

---

## Prerequisites

- A Google Cloud account with billing enabled
- A GitHub repository with your Node.js app
- `gcloud` CLI installed locally

---

## Step 1: Create a GCP Project and Enable APIs

```bash
# Login and create project
gcloud auth login
gcloud projects create my-node-app
gcloud config set project my-node-app

# Enable required APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com
```

---

## Step 2: Create an Artifact Registry Repository

This is where your Docker images will be stored.

```bash
gcloud artifacts repositories create node-app-repo \
  --repository-format=docker \
  --location=us-central1
```

---

## Step 3: Create a Service Account for GitHub Actions

```bash
# Create service account
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Deployer"

# Give it the required permissions
export SA="github-deployer@my-node-app.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "${SA}" \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser"

# Download the key
gcloud iam service-accounts keys create key.json --iam-account="${SA}"
cat key.json  # Copy this for GitHub Secrets
```

---

## Step 4: Add a Dockerfile to Your Project

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/index.js"]
```

> **Important:** Your app must read `process.env.PORT` — Cloud Run always injects `PORT=8080`.

```typescript
// src/index.ts
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
```

---

## Step 5: Add GitHub Secrets

Go to your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | `my-node-app` |
| `GCP_SA_KEY` | Full contents of `key.json` |
| `GCP_REGION` | `us-central1` |

---

## Step 6: Create the GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: ${{ secrets.GCP_REGION }}
  SERVICE: my-node-app
  IMAGE: us-central1-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/node-app-repo/my-node-app

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

      - name: Build and push Docker image
        run: |
          docker build -t ${{ env.IMAGE }}:${{ github.sha }} .
          docker push ${{ env.IMAGE }}:${{ github.sha }}

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE }}
          region: ${{ env.REGION }}
          image: ${{ env.IMAGE }}:${{ github.sha }}
          flags: |
            --allow-unauthenticated
            --port=8080
            --set-env-vars=NODE_ENV=production
```

---

## Step 7: Push and Watch it Deploy

```bash
git add .
git commit -m "add cloud run deployment"
git push origin main
```

Go to **Actions** in your GitHub repo to watch the workflow run. Once done, your app will be live at a URL like:

```
https://my-node-app-xxxxxxxxxx-uc.a.run.app
```

---

## Useful Commands

```bash
# Get your service URL
gcloud run services describe my-node-app --region=us-central1 --format="value(status.url)"

# View logs
gcloud run services logs tail my-node-app --region=us-central1

# List revisions
gcloud run revisions list --service=my-node-app --region=us-central1
```