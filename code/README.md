# Express Js With Typescript Starter KIT 🙌

## Local Development (No Docker)

After cloning, run the below command to run the project:

```bash
npm install && npm run dev
```

**Now All Set you can open below url to see your page**

```
http://localhost:8000
```

---

## Docker Compose Setup (with Nginx Proxy)

We have added an **Nginx Proxy Server** container in front of the Express app container. To build and run both services together:

### Prerequisites

- Docker and Docker Compose installed.

### Run with Docker Compose

1. **Start the services:**
   ```bash
   docker compose up -d --build
   ```
   This will:
   - Build the Express app image via a multi-stage Dockerfile.
   - Start the Express app container.
   - Start the Nginx container, exposing port `80` to your host, proxying requests to the Express app.

2. **Access the application:**
   Open the following URL in your browser:
   ```
   http://localhost
   ```

3. **Check logs:**
   ```bash
   docker compose logs -f
   ```

4. **Stop the services:**
   ```bash
   docker compose down
   ```

