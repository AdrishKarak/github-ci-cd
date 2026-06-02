# Deploy a Node.js App to GCP Cloud Run via GitHub Actions CI/CD

A complete, step-by-step guide to deploying a containerized Node.js (Express/TypeScript) application to **Google Cloud Run** using a fully automated GitHub Actions pipeline — with zero-downtime deployments, rollback support, secret management, and health checks.

---

## Architecture Overview

```
GitHub Push → GitHub Actions CI/CD
                 ├── Build & Test
                 ├── Build Docker Image
                 ├── Push to Artifact Registry
                 └── Deploy to Cloud Run
                          └── HTTPS Traffic → Cloud Run Service
```

**Why Cloud Run over EC2?**
- Fully managed — no server patching or Nginx config
- Auto-scales to zero (pay only for requests)
- Built-in HTTPS with a `*.run.app` domain
- Rolling deployments and traffic splitting out of the box

---

## Prerequisites

- A **Google Cloud** account with billing enabled
- A **GitHub** repository with your Node.js app
- `gcloud` CLI installed locally (for initial setup)
- Docker installed locally (for testing your image)

---

## Part 1: Google Cloud Setup

### Step 1: Create a GCP Project

```bash
# Authenticate
gcloud auth login

# Create a new project (or use existing)
gcloud projects create my-node-app --name="My Node App"

# Set it as the active project
gcloud config set project my-node-app

# Enable billing (required for Cloud Run)
# Do this via: https://console.cloud.google.com/billing
```

### Step 2: Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com
```

> These APIs cover Cloud Run, the Docker image registry, build tools, secret storage, and IAM permissions respectively.

### Step 3: Create an Artifact Registry Repository

This replaces the older Google Container Registry (GCR). All Docker images will be stored here.

```bash
gcloud artifacts repositories create node-app-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker images for Node app"
```

Your full image path will be:

```
us-central1-docker.pkg.dev/my-node-app/node-app-repo/express-app
```

### Step 4: Create a Service Account for GitHub Actions

Never use your personal Google account credentials in CI/CD. Create a dedicated service account with the minimum required permissions.

```bash
# Create the service account
gcloud iam service-accounts create github-actions-deployer \
  --display-name="GitHub Actions Deployer" \
  --description="Used by GitHub Actions to deploy to Cloud Run"

# Store the service account email for convenience
export SA_EMAIL="github-actions-deployer@my-node-app.iam.gserviceaccount.com"
```

### Step 5: Grant Required IAM Roles

```bash
# Allow pushing Docker images to Artifact Registry
gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# Allow deploying to Cloud Run
gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

# Allow the service account to act as a service account (required for Cloud Run deploys)
gcloud iam service-accounts add-iam-policy-binding \
  "${SA_EMAIL}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

# Allow reading secrets from Secret Manager (for runtime env vars)
gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

### Step 6: Create and Download a Service Account Key

```bash
gcloud iam service-accounts keys create github-actions-key.json \
  --iam-account="${SA_EMAIL}"

# Print the key to copy into GitHub Secrets
cat github-actions-key.json
```

> **Security:** Never commit `github-actions-key.json` to your repo. Add it to `.gitignore` immediately.

---

## Part 2: Application Setup

### Step 7: Add a Dockerfile

Create a `Dockerfile` at the root of your project:

```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package*.json ./
RUN npm ci

# Copy source and build TypeScript
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from build stage
COPY --from=builder /app/dist ./dist

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Cloud Run injects the PORT environment variable
# Your app MUST listen on this port
EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
```

> **Important:** Cloud Run always injects a `PORT` environment variable (default `8080`). Your app must read `process.env.PORT` — not hardcode a port.

Update your `src/index.ts` (or `src/index.js`):

```typescript
const PORT = parseInt(process.env.PORT || "8080", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Step 8: Add a .dockerignore File

```dockerignore
node_modules
npm-debug.log
.git
.gitignore
.env
.env.*
dist
*.md
coverage
.nyc_output
```

### Step 9: Create a PM2 Ecosystem Config (Optional)

If you want PM2 inside the container for process management, create `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: "express-app",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
```

> For Cloud Run, a simple `node dist/index.js` entrypoint is usually preferred over PM2, since Cloud Run manages container lifecycles.

### Step 10: Add Health Check Endpoint

Cloud Run checks your service health via HTTP. Add a `/health` route:

```typescript
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
```

---

## Part 3: Secret Management

### Step 11: Store Secrets in GCP Secret Manager

Never pass secrets as plain environment variables in your workflow file. Use Secret Manager instead.

```bash
# Example: store a database URL
echo -n "postgresql://user:password@host:5432/mydb" | \
  gcloud secrets create DATABASE_URL \
    --data-file=- \
    --replication-policy=automatic

# Add a new version (rotate a secret)
echo -n "new-secret-value" | \
  gcloud secrets versions add DATABASE_URL --data-file=-

# List secrets
gcloud secrets list
```

Cloud Run can mount secrets directly from Secret Manager at deploy time — no code changes needed.

---

## Part 4: GitHub Secrets Configuration

### Step 12: Add GitHub Repository Secrets

In your GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Description |
|---|---|---|
| `GCP_PROJECT_ID` | `my-node-app` | Your GCP project ID |
| `GCP_SA_KEY` | *(contents of `github-actions-key.json`)* | Full JSON service account key |
| `GCP_REGION` | `us-central1` | Cloud Run deployment region |
| `IMAGE_NAME` | `express-app` | Name for your Docker image |

To get the service account key content:

```bash
cat github-actions-key.json
# Copy the ENTIRE JSON output including { and }
```

---

## Part 5: GitHub Actions Workflow

### Step 13: Create the Workflow File

Create `.github/workflows/deploy.yml` in your repository:

```yaml
name: Deploy to GCP Cloud Run

on:
  push:
    branches: [main]
  workflow_dispatch: # Enable manual triggers from GitHub UI

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: ${{ secrets.GCP_REGION }}
  IMAGE_NAME: ${{ secrets.IMAGE_NAME }}
  REGISTRY: us-central1-docker.pkg.dev
  REPOSITORY: node-app-repo
  SERVICE_NAME: express-app

jobs:
  # -------------------------------------------------------
  # JOB 1: Run Tests
  # -------------------------------------------------------
  test:
    name: Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint --if-present

      - name: Run tests
        run: npm test --if-present

      - name: Build TypeScript (validate compilation)
        run: npm run build

  # -------------------------------------------------------
  # JOB 2: Build and Push Docker Image
  # -------------------------------------------------------
  build-and-push:
    name: Build & Push Image
    runs-on: ubuntu-latest
    needs: test # Only runs if test job passes
    outputs:
      image-tag: ${{ steps.meta.outputs.image-tag }}
      image-digest: ${{ steps.build-push.outputs.digest }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker ${{ env.REGISTRY }} --quiet

      - name: Generate image metadata (tags)
        id: meta
        run: |
          SHORT_SHA=$(echo "${{ github.sha }}" | cut -c1-7)
          IMAGE_TAG="${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}"
          echo "image-tag=${IMAGE_TAG}:${SHORT_SHA}" >> $GITHUB_OUTPUT
          echo "image-latest=${IMAGE_TAG}:latest" >> $GITHUB_OUTPUT
          echo "short-sha=${SHORT_SHA}" >> $GITHUB_OUTPUT
          echo "Building image: ${IMAGE_TAG}:${SHORT_SHA}"

      - name: Build Docker image
        id: build-push
        run: |
          docker build \
            --tag "${{ steps.meta.outputs.image-tag }}" \
            --tag "${{ steps.meta.outputs.image-latest }}" \
            --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --build-arg GIT_COMMIT="${{ github.sha }}" \
            --cache-from "${{ steps.meta.outputs.image-latest }}" \
            --file Dockerfile \
            .

      - name: Push Docker image to Artifact Registry
        run: |
          docker push "${{ steps.meta.outputs.image-tag }}"
          docker push "${{ steps.meta.outputs.image-latest }}"
          echo "Pushed: ${{ steps.meta.outputs.image-tag }}"

  # -------------------------------------------------------
  # JOB 3: Deploy to Cloud Run
  # -------------------------------------------------------
  deploy:
    name: Deploy to Cloud Run
    runs-on: ubuntu-latest
    needs: build-and-push

    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Compute image tag
        id: image
        run: |
          SHORT_SHA=$(echo "${{ github.sha }}" | cut -c1-7)
          echo "tag=${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${SHORT_SHA}" >> $GITHUB_OUTPUT

      - name: Deploy to Cloud Run
        id: deploy
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE_NAME }}
          region: ${{ env.REGION }}
          image: ${{ steps.image.outputs.tag }}
          # Traffic: send 100% to the new revision immediately
          # Change to a lower number (e.g. 10) for canary deployments
          flags: |
            --allow-unauthenticated
            --port=8080
            --min-instances=0
            --max-instances=10
            --memory=512Mi
            --cpu=1
            --concurrency=80
            --timeout=60
            --set-secrets=DATABASE_URL=DATABASE_URL:latest
            --set-env-vars=NODE_ENV=production
          tag: ${{ github.sha }}

      - name: Output deployment URL
        run: echo "Deployed to ${{ steps.deploy.outputs.url }}"

  # -------------------------------------------------------
  # JOB 4: Verify Deployment
  # -------------------------------------------------------
  verify:
    name: Verify Deployment
    runs-on: ubuntu-latest
    needs: deploy

    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Get service URL
        id: get-url
        run: |
          URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} \
            --region=${{ env.REGION }} \
            --format="value(status.url)")
          echo "url=${URL}" >> $GITHUB_OUTPUT
          echo "Service URL: ${URL}"

      - name: Wait for service to be ready
        run: sleep 15

      - name: Health check
        run: |
          echo "Running health check on ${{ steps.get-url.outputs.url }}/health"
          for i in {1..5}; do
            echo "Attempt $i of 5..."
            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
              "${{ steps.get-url.outputs.url }}/health" 2>/dev/null || echo "000")

            if [ "$HTTP_STATUS" = "200" ]; then
              echo "✅ Health check passed! Status: $HTTP_STATUS"
              echo "App is live at: ${{ steps.get-url.outputs.url }}"
              exit 0
            fi

            echo "Got status $HTTP_STATUS, retrying in 10 seconds..."
            sleep 10
          done

          echo "❌ Health check failed after 5 attempts"
          exit 1

  # -------------------------------------------------------
  # JOB 5: Rollback on Failure
  # -------------------------------------------------------
  rollback:
    name: Rollback on Failure
    runs-on: ubuntu-latest
    needs: [deploy, verify]
    if: failure() # Only runs if deploy or verify fails

    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Get previous revision
        id: prev-revision
        run: |
          # List revisions sorted by creation time, skip the latest (broken one)
          PREV_REVISION=$(gcloud run revisions list \
            --service=${{ env.SERVICE_NAME }} \
            --region=${{ env.REGION }} \
            --format="value(metadata.name)" \
            --sort-by="~metadata.creationTimestamp" \
            --limit=5 | sed -n '2p')

          echo "previous=${PREV_REVISION}" >> $GITHUB_OUTPUT
          echo "Found previous revision: ${PREV_REVISION}"

      - name: Roll back traffic to previous revision
        run: |
          if [ -n "${{ steps.prev-revision.outputs.previous }}" ]; then
            gcloud run services update-traffic ${{ env.SERVICE_NAME }} \
              --region=${{ env.REGION }} \
              --to-revisions="${{ steps.prev-revision.outputs.previous }}=100"
            echo "✅ Rolled back to: ${{ steps.prev-revision.outputs.previous }}"
          else
            echo "⚠️  No previous revision found. Manual intervention required."
            exit 1
          fi
```

---

## Part 6: Advanced Configurations

### Traffic Splitting (Canary Deployments)

Instead of sending 100% traffic to the new revision immediately, you can do a gradual rollout:

```bash
# Send 10% traffic to new revision, 90% to stable
gcloud run services update-traffic express-app \
  --region=us-central1 \
  --to-revisions=NEW_REVISION=10,STABLE_REVISION=90

# Once verified, promote to 100%
gcloud run services update-traffic express-app \
  --region=us-central1 \
  --to-latest
```

### Configuring a Custom Domain

```bash
# Map your domain to the Cloud Run service
gcloud run domain-mappings create \
  --service=express-app \
  --domain=api.yourdomain.com \
  --region=us-central1
```

Then add the provided DNS records to your domain registrar. Cloud Run automatically provisions an SSL certificate.

### Keeping the Service Warm (Avoid Cold Starts)

```bash
# Set minimum instances to 1 to avoid cold starts
gcloud run services update express-app \
  --region=us-central1 \
  --min-instances=1
```

### Viewing Logs

```bash
# Stream live logs
gcloud run services logs tail express-app --region=us-central1

# View recent logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="express-app"' \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

---

## Part 7: Local Testing with Docker

Before pushing, test your Docker image locally to catch issues early:

```bash
# Build image locally
docker build -t express-app:local .

# Run with environment variables
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e DATABASE_URL="your-local-db-url" \
  express-app:local

# Test the health endpoint
curl http://localhost:8080/health
```

---

## Troubleshooting

### Common Issues

**Container fails to start:**
```bash
gcloud run revisions describe REVISION_NAME \
  --region=us-central1 \
  --format="yaml(status)"
```
Most often caused by the app not listening on `process.env.PORT`.

**Permission denied pushing image:**
```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

**Service account missing permissions:**
```bash
gcloud projects get-iam-policy my-node-app \
  --flatten="bindings[].members" \
  --filter="bindings.members:github-actions-deployer"
```

**Secret not accessible:**
```bash
gcloud secrets get-iam-policy DATABASE_URL
```

### Useful Commands

```bash
# List all Cloud Run services
gcloud run services list

# List all revisions for a service
gcloud run revisions list --service=express-app --region=us-central1

# Describe a specific service
gcloud run services describe express-app --region=us-central1

# Delete old revisions (cleanup)
gcloud run revisions delete OLD_REVISION_NAME --region=us-central1
```

---

## Cost Considerations

Cloud Run charges based on actual usage (CPU + memory per request). For most small-to-medium apps:

- `--min-instances=0`: Free when idle (cold start on first request)
- `--min-instances=1`: ~$10–15/month for always-warm instance
- Free tier: 2 million requests/month, 360,000 vCPU-seconds, 180,000 GB-seconds

---

## Summary

| Step | What You Did |
|---|---|
| 1–3 | Created GCP project, enabled APIs, set up Artifact Registry |
| 4–6 | Created service account with least-privilege IAM roles |
| 7–10 | Added Dockerfile, .dockerignore, health check to your app |
| 11 | Stored secrets in Secret Manager (not in code) |
| 12 | Added GCP credentials to GitHub Secrets |
| 13 | Created a 5-job GitHub Actions workflow (test → build → deploy → verify → rollback) |