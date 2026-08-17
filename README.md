# STDISCM-P4-Distributed-Fault-Tolerance

This project demonstrates **distributed fault tolerance** using Dockerized services.  
The system is designed so that the **main service continues running even if the login service goes down**, ensuring availability of core functionality.

---

## ⚙️ Prerequisites
- Docker (latest stable version)
- Docker Compose v2+
- Git (to clone repository)

---

## 🚀 Running with Docker Compose
1. Start the services:
   ```bash
   docker compose up --build
   ```

2. Access the app:
   - Main Service: `http://localhost:5000`
   - Login Service: `http://localhost:5001`

3. Stop services:
   ```bash
   docker compose down
   ```

---

## 🔄 Fault Tolerance Testing
- Kill the login container:
  ```bash
  docker ps
  docker stop <login_container_id>
  ```
- Verify that the **main service remains accessible** at `http://localhost:5000`.

---

## 📖 Notes
- The **login service is isolated** so its downtime does not affect the main app.
- Logs can be viewed with:
  ```bash
  docker compose logs -f
  ```

---

## ✅ Deliverables
- Source code implementing distributed fault tolerance.
- Docker Compose setup with separate **login** and **main** services.