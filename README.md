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

Then open `http://localhost:3000/clients.html` to log in. Two default seeded accounts are created on first run:

**Regular Client:**
- email: `client@ivory.example`
- password: `ChangeMe123!`

**Administrator:**
- email: `admin@ivory.example`
- password: `AdminChangeMe!`

Administrators have additional privileges and can access the admin dashboard at `/admin.html` to:
- Upload specification sheets and other protected files
- Manage user accounts (view, delete, promote/demote)
- View audit logs of all administrative actions

## API Endpoints

### Authentication
- `POST /api/login` - Login with email and password
- `POST /api/logout` - Logout (requires authenticated session)
- `GET /api/me` - Get current authenticated user info
- `POST /api/register` - Register new user (email verification required)
- `POST /api/request-password-reset` - Request password reset email
- `POST /api/reset-password` - Reset password with token
- `POST /api/verify-email` - Verify email with token

### File Management (Admin Only)
- `POST /api/upload` - Upload a file (multipart/form-data)
- `GET /api/files` - List all uploaded files
- `DELETE /api/files/:id` - Delete a file
- `GET /protected-files/:id` - Download a file (authenticated clients only)

### User Management (Admin Only)
- `GET /api/users` - List all users
- `PATCH /api/users/:id` - Toggle user admin role
- `DELETE /api/users/:id` - Delete a user account

### Audit & Logging (Admin Only)
- `GET /api/audit-logs` - View audit logs (latest 100 entries)

For security reasons, change the seeded passwords immediately in production. You can register additional admin users via the `/api/register` endpoint and then promote them to admin through the admin dashboard UI.

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

## Security Features

The application includes enterprise-grade security features to protect user accounts and maintain audit trails:

### Email Verification
- New registrations require email verification before account activation
- Users receive a verification email with a link (valid for 24 hours)
- Email verification prevents spam registrations and ensures valid contact information
- Unverified accounts cannot log in

### Password Reset
- Users can request a password reset via the "Forgot Password?" link on the login page
- A password reset link is sent via email (valid for 1 hour)
- Password reset tokens are cryptographically secure and single-use
- Passwords are hashed using bcrypt with 10 salt rounds

### Login Rate Limiting
- Prevents brute-force attacks by limiting login attempts
- Maximum 10 login attempts per 15 minutes per IP address
- Rate limit errors return HTTP 429 (Too Many Requests)
- Helps protect accounts from unauthorized access attempts

### Audit Logging
- All administrative actions are logged for accountability and security monitoring
- Logged actions include:
  - User registration and email verification
  - Password reset requests and completions
  - File uploads and deletions
  - User role changes (promote/demote)
  - User account deletions
- Audit logs are viewable in the Admin Dashboard (requires admin role)
- Each log entry includes timestamp, action type, user ID, resource ID, and details

### Email Configuration
To enable email verification and password reset features, configure SMTP settings in your `.env` file:

```bash
APP_URL=https://your-domain.example              # Base URL for email links
MAIL_HOST=smtp.gmail.com                         # SMTP server hostname
MAIL_PORT=587                                    # SMTP port (typically 587 or 465)
MAIL_SECURE=false                                # Use TLS (false for 587, true for 465)
MAIL_USER=your-email@gmail.com                   # SMTP username
MAIL_PASSWORD=your-app-password-or-token         # SMTP password or auth token
MAIL_FROM=noreply@your-domain.example            # From address for emails
```

**Email provider examples:**
- **Gmail**: Use an [App Password](https://myaccount.google.com/apppasswords) instead of your account password
- **SendGrid**: Use `apikey` as username and your API key as password
- **AWS SES**: Use SMTP credentials from your SES console
- **Mailgun**: Use `postmaster@yourdomain.mailgun.org` as username and your SMTP password

If email is not configured, password reset and verification emails will fail silently in development but should be configured for production.

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
