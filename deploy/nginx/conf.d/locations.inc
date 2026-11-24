location /api/ {
  limit_req zone=api burst=40 nodelay;
  proxy_pass http://backend:8000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 300s;   # agent / LLM requests can take minutes
}
location ~ ^/(health|docs|openapi.json)$ { proxy_pass http://backend:8000; proxy_set_header Host $host; }
location / { proxy_pass http://frontend:8080; proxy_set_header Host $host; }
