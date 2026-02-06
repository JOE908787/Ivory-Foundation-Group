# Ivory Foundation Group Website

A professional, responsive website for Ivory Foundation Group - showcasing the organization's mission, services, and impact.

## Features

- **Responsive Design**: Mobile-friendly layout that works on all devices
- **Multiple Pages**: Home, About, Services pages with rich content
- **Contact Form**: Easy way for visitors to get in touch
- **Smooth Navigation**: Smooth scrolling and active page indicators
- **Modern Styling**: Clean, professional design with a green color scheme

## Pages

### Home (`index.html`)
- Hero section with call-to-action
- Mission overview
- Featured services preview
- Contact section

### About (`about.html`)
- Organization mission and vision
- Core values (6 key pillars)
- Organization story and history
- Call to action for involvement

### Services (`services.html`)
- Detailed descriptions of all programs:
  - Community Support Programs
  - Education & Skills Development
  - Health & Wellness Initiatives
  - Economic Empowerment
  - Environmental Sustainability

## File Structure

```
Ivory-Foundation-Group/
├── index.html          # Home page
├── about.html          # About page
├── services.html       # Services page
├── css/
│   └── style.css       # Main stylesheet
├── js/
│   └── script.js       # JavaScript functionality
└── README.md           # This file
```

## Technologies Used

- **HTML5**: Semantic markup
- **CSS3**: Responsive design with flexbox and grid
- **JavaScript**: Interactivity and form handling

## Key Features

### Responsive Grid Layouts
- Services displayed in flexible grid that adapts to screen size
- Values section with card-based layout

### Form Handling
- Contact form with validation
- User-friendly error and success messages

### Interactive Elements
- Smooth scroll navigation
- Fade-in animations on scroll
- Hover effects on cards and buttons

### Accessibility
- Semantic HTML structure
- Clear navigation hierarchy
- Readable typography

## How to Use

1. Open `index.html` in a web browser to view the website
2. Navigate between pages using the top navigation bar
3. Click "Learn More" buttons to explore different sections
4. Fill out the contact form to get in touch

## Running the protected client portal (server-side login)

The project includes a small Express server to provide secure login and a protected client portal. It serves the static site and provides `/api/login`, `/api/logout`, and `/portal` for authenticated clients.

Run the server from the project folder:

```bash
cd Ivory-Foundation-Group/server
npm install
npm start
```

Then open `http://localhost:3000/clients.html` to log in. A default seeded client is created on first run:

- email: `client@ivory.example`
- password: `ChangeMe123!`

Change the seeded password by registering a new client with the `/api/register` endpoint or update the database directly.

## HTTPS and Deployment

For production you should run the server behind HTTPS. Two options:

- Use a hosting provider (recommended): deploy to a platform such as DigitalOcean, Render, or Heroku and enable TLS via their managed certificates.
- Self-host with Nginx as a reverse proxy and obtain certificates from Let's Encrypt.

Example `nginx` snippet to proxy and terminate TLS:

```nginx
server {
  listen 80;
  server_name your-domain.example;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name your-domain.example;

  ssl_certificate /etc/letsencrypt/live/your-domain/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Deployment notes:

- Set a secure `SESSION_SECRET` environment variable and update `server/index.js` to read it from `process.env.SESSION_SECRET` before using in production.
- Use a managed database or back up `server/db.sqlite` regularly.
- Run the Node process under a process manager (systemd, pm2) and enable firewall rules.

Detailed deployment options
---------------------------

1) Nginx reverse-proxy + systemd (recommended)

- Install Node on the server and copy the project to `/home/ear/Ivory/Ivory-Foundation-Group`.
- Install dependencies and set env vars:

```bash
cd /home/ear/Ivory/Ivory-Foundation-Group/server
npm ci
export SESSION_SECRET="$(openssl rand -hex 32)"
```

- Create a systemd unit file (example provided at `deploy/ivory.service`) and modify `WorkingDirectory`/`User`/`SESSION_SECRET` as needed. Then enable & start:

```bash
sudo cp deploy/ivory.service /etc/systemd/system/ivory.service
sudo systemctl daemon-reload
sudo systemctl enable --now ivory.service
```

- Use the example `nginx` configuration above to proxy `https://your-domain` to `http://127.0.0.1:3000` and obtain TLS via Certbot:

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

2) PM2 process manager

- Install pm2 and start the app using provided ecosystem config:

```bash
npm install -g pm2
cd /home/ear/Ivory/Ivory-Foundation-Group
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

3) Docker (containerized)

- Build and run the container (terminate TLS at the host with Nginx or use a reverse proxy container):

```bash
cd /home/ear/Ivory/Ivory-Foundation-Group/server
docker build -t ivory-portal:latest .
docker run -e SESSION_SECRET="$(openssl rand -hex 32)" -p 3000:3000 -d ivory-portal:latest
```

4) Docker Compose + Traefik (recommended — automatic TLS)

This repository includes a ready `deploy/docker-compose.yml` that runs Traefik to obtain Let's Encrypt certificates and your app in a container. Steps:

```bash
cd /home/ear/Ivory/Ivory-Foundation-Group
cp .env.example .env
# Edit .env and set DOMAIN and LETSENCRYPT_EMAIL, and SESSION_SECRET
sudo chmod 600 deploy/traefik/acme.json
docker compose -f deploy/docker-compose.yml up -d --build
```

After a few moments Traefik will obtain certificates and your site will be available at `https://$DOMAIN`.

Notes:
- Ensure port 80 and 443 are reachable from the internet for domain verification.
- The `deploy/traefik/acme.json` file must be writable by the Traefik container and secured (`chmod 600`).
- To view Traefik dashboard: `http://localhost:8080` if you enable the dashboard and map a port (not recommended for production without auth).

4) Securing the app

- Use `SESSION_SECRET` (strong, random) in production.
- Configure your reverse proxy (Nginx) to set `proxy_set_header X-Forwarded-Proto $scheme;` and enable `app.set('trust proxy', 1)` by setting `TRUST_PROXY=1` in the environment.
- Enable firewall (allow 80/443) and restrict direct access to the Node port (3000) to localhost only.

5) Let’s Encrypt / Certbot

- Use `certbot --nginx` to automatically obtain and install certificates for Nginx as shown above. Certbot will configure renewal automatically.

If you'd like, I can: create a `systemd` user service configured for your environment, deploy a Docker Compose that includes an Nginx reverse proxy with Let's Encrypt (via `linuxserver/letsencrypt` or `traefik`), or help provision a VM on a provider (DigitalOcean) and deploy end-to-end.

## Customization

### Colors
The main color scheme uses:
- Dark Green: `#1a472a` - Primary color
- Light Green: `#90ee90` - Accent color
- Light Gray: `#f5f5f5` - Background

To change colors, edit the color values in `css/style.css`

### Content
All text can be easily updated by editing the HTML files directly.

### Contact Information
Add your organization's actual contact details in the footer and contact form areas.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers

## Future Enhancements

Possible features to add:
- Blog section
- Donation/Support page
- Team member profiles
- Image galleries
- Newsletter signup
- Social media integration
- Search functionality

## License

© 2026 Ivory Foundation Group. All rights reserved.
