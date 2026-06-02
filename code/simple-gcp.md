## Deploy the Node.js backend to GCP Cloud Run using an automated GitHub Actions CI/CD workflow

After creating your GCP project and enabling billing, follow these steps to deploy the application:

#### Step 1: Install and configure the gcloud CLI on your local machine:

```bash
# Install gcloud CLI (if not already installed)
# https://cloud.google.com/sdk/docs/install

# Login to your Google account
gcloud auth login

# Create a new project
gcloud projects create my-node-app

# Set it as active
gcloud config set project my-node-app
```

**Make sure billing is enabled on your project before continuing.**

#### Step 2: Enable the required APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com
```

#### Step 3: Create a Service Account for GitHub Actions:

```bash
# Create the service account
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Deployer"

# Store the email in a variable
export SA="github-deployer@my-node-app.iam.gserviceaccount.com"

# Grant the required roles
gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/run.admin"

gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding my-node-app \
  --member="serviceAccount:${SA}" --role="roles/storage.admin"
```

#### Step 4: Download the Service Account key:

```bash
gcloud iam service-accounts keys create gcp-key.json \
  --iam-account="${SA}"

# Print the key content — you will copy this into GitHub Secrets
cat gcp-key.json
```

**Never commit gcp-key.json to your repo. Add it to .gitignore immediately.**

#### Step 5: Make sure your app reads PORT from the environment:

Cloud Run injects `PORT=8080` into your container. Your app must use it:

```typescript
// src/index.ts
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

Also make sure your `package.json` has a `start` script:

```json
{
  "scripts": {
    "start": "node dist/index.js"
  }
}
```

#### Step 6: Create GitHub Secrets for Deployment

In your GitHub repository, go to Settings → Secrets and variables → Actions → New repository secret.

Add These Secrets

**GCP_PROJECT_ID - Your GCP project ID:**
**GCP_SA_KEY - The full contents of gcp-key.json:**
**GCP_REGION - Your Cloud Run region (e.g. us-central1):**

```bash
# Copy the full JSON content including the curly braces
cat gcp-key.json
```

#### Step 7: Create GitHub Actions Workflow

In your repository, create .github/workflows/deploy.yml

```yml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]
  workflow_dispatch: # manual trigger

jobs:
  deploy:
    name: Build and Deploy
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

      - name: Build with Cloud Build
        run: |
          gcloud builds submit \
            --pack image=gcr.io/${{ secrets.GCP_PROJECT_ID }}/my-node-app \
            .

      - name: Deploy to Cloud Run
        id: deploy
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: my-node-app
          region: ${{ secrets.GCP_REGION }}
          image: gcr.io/${{ secrets.GCP_PROJECT_ID }}/my-node-app
          flags: |
            --allow-unauthenticated
            --port=8080
            --min-instances=0
            --max-instances=10
            --set-env-vars=NODE_ENV=production

      - name: Verify deployment
        run: |
          echo "Waiting for service to be ready..."
          sleep 10

          SERVICE_URL=$(gcloud run services describe my-node-app \
            --region=${{ secrets.GCP_REGION }} \
            --format="value(status.url)")

          for i in {1..3}; do
            echo "Attempt $i of 3..."
            response=$(curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL} 2>/dev/null || echo "000")

            if [ "$response" = "200" ] || [ "$response" = "301" ] || [ "$response" = "302" ]; then
              echo "✅ Deployment successful! App is responding with status: $response"
              echo "Live at: ${SERVICE_URL}"
              exit 0
            fi

            echo "Got response: $response, waiting 5 seconds..."
            sleep 5
          done

          echo "❌ Deployment verification failed"
          exit 1

      - name: Rollback on failure
        if: failure()
        run: |
          echo "🔄 Rolling back to previous revision..."

          PREV_REVISION=$(gcloud run revisions list \
            --service=my-node-app \
            --region=${{ secrets.GCP_REGION }} \
            --sort-by="~metadata.creationTimestamp" \
            --format="value(metadata.name)" \
            --limit=5 | sed -n '2p')

          if [ -n "$PREV_REVISION" ]; then
            gcloud run services update-traffic my-node-app \
              --region=${{ secrets.GCP_REGION }} \
              --to-revisions="${PREV_REVISION}=100"
            echo "✅ Rolled back to: ${PREV_REVISION}"
          else
            echo "⚠️ No previous revision found, cannot rollback"
          fi
```