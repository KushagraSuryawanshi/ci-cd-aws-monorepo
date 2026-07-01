# Notes

This repo was mainly a play around to understand how a full-stack Turborepo monorepo can be deployed manually first, then automated with Github Actions.

I wanted to understand the full path properly:

```txt
local monorepo
-> GitHub
-> staging EC2
-> production EC2
-> PM2 processes
-> nginx reverse proxy
-> staging and production databases
-> GitHub Actions CI/CD
```

This README is written more like revision notes than a project setup guide. It records what I built, what broke, what fixed it, and what should be remembered for next time.

---

## Final deployed structure

The project ended up with:

```txt
ci-cd-aws-monorepo

apps/
  http-server     Express / Node HTTP API
  ws-server       WebSocket server
  web             Next.js frontend

packages/
  prisma          Shared Prisma package
  typescript-config
```

Runtime services:

```txt
http-server  -> localhost:3000
ws-server    -> localhost:3001
fe-server    -> localhost:3002
```

Public routing:

```txt
nginx receives request on port 80
-> checks domain/subdomain
-> proxies to the correct local service
```

---

## Public URLs I used

These worked during the deployment test. Don’t try opening them now though, I’ve stopped the instances to save money 😛


### Staging

```txt
Frontend:
http://staging.ci-cd-aws-monorepo-fe.kushagrasuryawanshi.com

HTTP API:
http://staging.ci-cd-aws-monorepo-http.kushagrasuryawanshi.com

WebSocket:
ws://staging.ci-cd-aws-monorepo-ws.kushagrasuryawanshi.com
```

### Production

```txt
Frontend:
http://ci-cd-aws-monorepo-fe.kushagrasuryawanshi.com

HTTP API:
http://ci-cd-aws-monorepo-http.kushagrasuryawanshi.com

WebSocket:
ws://ci-cd-aws-monorepo-ws.kushagrasuryawanshi.com
```

---

## Environment setup

I used two separate AWS EC2 instances:

```txt
staging EC2
production EC2
```

I also used two separate Postgres databases from NeonDB:

```txt
staging database
production database
```

Each server has its own `.env` files with the correct database URL for that environment.

The important `.env` locations were:

```txt
apps/http-server/.env
apps/ws-server/.env
apps/web/.env
packages/prisma/.env
```

The mental model I settled on after fighting Prisma 7, bundlers, JIT packaging for a day:

```txt
@repo/db owns database code.
Each running app owns its runtime environment variables.
```

So even though it feels repetitive, each app that imports Prisma needs access to `DATABASE_URL`.

For this project, separate `.env` files made more sense than using one root `.env`, because Turborepo apps/packages are separate units and can have separate runtime requirements.

Important rule:

```txt
.env files live on the server.
```

Also, make sure `.gitignore` should include:

```gitignore
.env
**/.env
```
Otherwise, well… you know what could happen 😛
---

## Prisma and Turborepo notes

I used Prisma as a shared package inside the monorepo:

```txt
packages/prisma
```

The Prisma package exposes a Prisma client that other apps can import:

```ts
import { prisma } from "@repo/db";
```

The hardest part was understanding the difference between the Prisma/Turborepo docs and a plain Node runtime.

### JIT package vs compiled package

The Prisma Turborepo docs show a Just-in-Time package style where the package exports TypeScript source directly.

That can work nicely when the consuming app has a bundler or framework that understands TypeScript source.

But my backend was a plain compiled Node/Express app.  
So this became a problem:

```txt
http-server builds to dist
Node runs dist/app.js
@repo/db still points to TypeScript source
Node does not compile TypeScript package source for me
```

The clean solution was to treat `@repo/db` as a compiled package.


```txt
JIT package:
the consuming app compiles the package source

compiled package:
the package builds itself to dist first
```

For my setup, compiled package was easier to reason about.

---

## Prisma commands revisit

The important scripts inside `packages/prisma/package.json` were:

```json
{
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy"
  }
}
```

### `prisma generate`

```bash
pnpm --filter @repo/db db:generate
```

Meaning:

```txt
Read schema.prisma
Generate Prisma Client code
Update the TypeScript/JS client used by the app
```

This does not change the database.

### `prisma migrate dev`

```bash
pnpm --filter @repo/db db:migrate
```

Meaning:

```txt
Used locally during development
Creates a new migration file
Applies it to the development database
```

This is not what I want to run casually on staging/production.

### `prisma migrate deploy`

```bash
pnpm --filter @repo/db db:deploy
```

Meaning:

```txt
Used on staging/production
Applies already committed migration files
Does not create new migrations
```

Correct flow:

```txt
local machine:
change schema
run migrate dev
commit migration files

staging/production:
pull code
run migrate deploy
```

This is safer because production should not invent new migrations.

---

## Important pnpm workspace notes

In this repo I used pnpm workspaces.

Correct style:

```bash
pnpm install
pnpm --filter http-server start
pnpm --filter ws-server start
pnpm --filter web start
pnpm --filter @repo/db db:generate
```

Do not use `npm install` inside this workspace.

I hit this kind of issue earlier:

```txt
EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:*"
```

That happens because npm does not understand pnpm workspace protocol the same way.

Rule:

```txt
pnpm install ✅
pnpm add package ✅
pnpm --filter package-name add package ✅
npm install ❌ inside this pnpm workspace
```

However, this is fine:

```bash
pm2 start npm --name fe-server -- start
```

That only runs the `start` script from inside a package folder.  
It does not install packages.

---

## EC2 setup notes

Each EC2 instance needed:

```txt
Node
pnpm
PM2
nginx
repo cloned
env files added
database migrated
apps built
PM2 processes started
nginx configured
```

libs checks:

```bash
node -v
pnpm -v
pm2 -v
nginx -v
```

---

## The RAM and disk problem

One painful issue was this:

```txt
Killed pnpm install
```

At first I thought it was a dependency problem, but it was actually the EC2 instance running out of memory. my `broke ass` chose a t3.micro, and once the monorepo started building with only 1 GB RAM and 8 GB storage, the instance basically tapped out.

Then when I tried to add swap, I hit disk issues too:

```txt
No space left on device
```

The server originally had a small root disk, so modern JS dependencies filled it quickly.

### Disk check

```bash
df -h
```

This shows disk usage.

Example problem:

```txt
/dev/root  6.7G  6.6G  0  100% /
```

Meaning:

```txt
root disk is full
server cannot create more files
pnpm install cannot continue
```

### RAM check

```bash
free -h
```

This shows memory and swap.

### Swap

Swap is backup memory using disk space.

So basically:

```txt
RAM is real memory
swap is slower emergency memory on disk
```

Creating swap helped `pnpm install` survive on a small EC2 instance:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
```

Make it permanent after confirming it works:

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

But swap needs free disk space. If disk is already full, increasing disk first is the better fix.

---

## Expanding EC2 disk

After increasing the EBS volume size in AWS, Ubuntu did not automatically use the new space.

I saw something like:

```txt
nvme0n1      25G disk
nvme0n1p1   6.9G partition mounted on /
```

Meaning:

```txt
AWS disk is bigger
Linux partition is still small
filesystem is still small
```

The commands i used:

```bash
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1
df -h
```

Meaning:

```txt
growpart   -> expand partition 1 on the disk
resize2fs  -> expand the ext4 filesystem inside that partition
df -h      -> confirm usable disk increased
```

After this, `/` showed around 24GB usable, which fixed the disk issue.

---

## PM2 notes

I used PM2 to keep the apps running.

The final process names were:

```txt
http-server
ws-server
fe-server
```

### Folder style

From inside each app folder:

```bash
cd apps/http-server
pm2 start npm --name http-server -- start

cd ../ws-server
pm2 start npm --name ws-server -- start

cd ../web
pm2 start npm --name fe-server -- start
```

Meaning:

```txt
pm2 start npm     -> PM2 runs npm
--name fe-server  -> process name
-- start          -> passes "start" to npm
```

So PM2 runs:

```bash
npm start
```

but keeps it alive.

### Root monorepo style

This also works from repo root:

```bash
pm2 start pnpm --name http-server -- --filter http-server start
pm2 start pnpm --name ws-server -- --filter ws-server start
pm2 start pnpm --name fe-server -- --filter web start
```

I tried both styles to play around with commands.I found Root style to be cleaner for monorepo control.

### Useful PM2 commands

```bash
pm2 ls
pm2 logs http-server --lines 50
pm2 restart http-server
pm2 restart http-server --update-env
pm2 delete all
pm2 save
pm2 startup
```

Yeah, one important thing I missed few months ago, when I first used pm2 that, `pm2 save` matters because it saves the current PM2 process list so it can be resurrected after reboot.
and 
`--update-env` matters when env values might have changed.

PM2 process IDs can change after deleting/restarting.  
That is normal.

Better to use names, not IDs:

```bash
pm2 restart fe-server
```

---

## Next.js port issue

My HTTP server was already using port 3000.
But Next.js production start also defaults to port 3000 if I use:

```json
"start": "next start"
```

This caused:

```txt
Error: listen EADDRINUSE: address already in use :::3000
```

Fix:

```json
{
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start -p 3002"  
  }
}
```

Important lesson:

```txt
dev script and production start script are different
PM2 uses start, not dev
```

---

## nginx reverse proxy setup

nginx listens publicly on port 80 and routes traffic to local app ports.

Final routing idea:

```txt
frontend domain -> localhost:3002
http domain     -> localhost:3000
ws domain       -> localhost:3001
```

Example frontend config:

```nginx
server {
    listen 80;
    server_name staging.ci-cd-aws-monorepo-fe.kushagrasuryawanshi.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Example HTTP API config:

```nginx
server {
    listen 80;
    server_name staging.ci-cd-aws-monorepo-http.kushagrasuryawanshi.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Example WebSocket config:

```nginx
server {
    listen 80;
    server_name staging.ci-cd-aws-monorepo-ws.kushagrasuryawanshi.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

WebSocket needs:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

because WebSocket starts as HTTP and then upgrades into a long-lived connection.

Without those headers, nginx may treat it like normal HTTP and the WebSocket connection can fail.

### Enable site files

I used the normal nginx structure:

```txt
/etc/nginx/sites-available/
/etc/nginx/sites-enabled/
```

Create config:

```bash
sudo nano /etc/nginx/sites-available/staging-http
```

Enable config:

```bash
sudo ln -s /etc/nginx/sites-available/staging-http /etc/nginx/sites-enabled/staging-http
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## nginx long server name issue

Because my subdomains were long (purposefully), nginx failed with:

```txt
could not build server_names_hash, you should increase server_names_hash_bucket_size: 64
```

Fix was inside:

```bash
sudo nano /etc/nginx/nginx.conf
```

Inside the main `http {}` block:

```nginx
http {
    server_names_hash_bucket_size 128;

    ...
}
```

Important: this does not go inside individual `server {}` site files.  
It goes inside the main `http {}` block.

Then of course to check any error and reloading:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---


## GitHub Actions SSH deploy key

I did not put my personal EC2 `.pem` key (that I got from aws when creating instance) into GitHub.

Instead I created a separate deploy key for GitHub Actions:

```bash
mkdir -p ~/.ssh/aws/ci-cd-aws-monorepo
cd ~/.ssh/aws/ci-cd-aws-monorepo
ssh-keygen -t ed25519 -C "github-actions-ci-cd-aws-monorepo" -f github_actions_deploy_key
```

This created:

```txt
github_actions_deploy_key      private key
github_actions_deploy_key.pub  public key
```

Where they go:

```txt
private key -> GitHub Actions secret
public key  -> EC2 ~/.ssh/authorized_keys
```

The private key goes into Github secrets of this repo:

```txt
EC2_SSH_PRIVATE_KEY
```

I added the public key to both staging and production EC2 instances:

```bash
nano ~/.ssh/authorized_keys
```

Then pasted the `.pub` key on a new line.

So to sum around:

```txt
GitHub has private key
EC2 has matching public key
GitHub can SSH into EC2
```

---

## GitHub secrets used

For staging:

```txt
EC2_SSH_PRIVATE_KEY
STAGING_HOST
STAGING_USER
STAGING_APP_DIR
```

For production:

```txt
EC2_SSH_PRIVATE_KEY
PRODUCTION_HOST
PRODUCTION_USER
PRODUCTION_APP_DIR
```

Values like host/user/app path are not as sensitive as the private key, but I stored them as secrets to keep workflow logs cleaner.

GitHub masks secret values in logs:

```txt
***@*** "cd *** && pwd && hostname"
```

But if the remote server prints something like its internal hostname, GitHub will show it because that output is not exactly the secret value.

---

## Dev vs Prod

I used two deployment workflows:

```txt
push to main        -> deploy staging
push to production  -> deploy production
```

This means:

```txt
main is my staging branch
production is my production release branch
```

so:

```txt
main was tested on staging
then main is merged into production
then production deploy runs
```

This is safer than deploying production on every push to main.

---


## Why in workflow files I used `git fetch` + `git reset --hard`

Instead of:

```bash
git pull origin main
```

I used:

```bash
git fetch origin main
git reset --hard origin/main
```

Meaning:

```txt
make the server code exactly match the GitHub branch
```

This I think is better for deployment because the server should not create merge commits or get stuck in merge conflicts.

Important:

```bash
git reset --hard origin/main
```

resets tracked files only.

It does not delete untracked `.env` files. Which I was unaware of🫩

---

## Why I avoided `git clean`

`git clean` deletes untracked files.

Dangerous examples:

```bash
git clean -fd
git clean -fdx
```

`git clean -fdx` is especially dangerous because it can delete ignored files too.

That could remove:

```txt
.env files
node_modules
server-only files
```

So I did not use `git clean` in this deployment.

---

## NVM issue inside GitHub Actions SSH

Manual SSH worked, but GitHub Actions SSH initially could not find commands like:

```txt
node
pnpm
pm2
```

Reason:

```txt
manual terminal loads nvm
non-interactive GitHub SSH command may not load nvm automatically
```

Fix inside every remote SSH command that needs Node:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

This loads nvm into that SSH session.

This is not the Docker-style deployment approach, but I was just trying classic VM deployment path.

With Docker, the flow can become cleaner:

```txt
GitHub Actions builds image
pushes image
EC2 pulls image
Docker Compose restarts containers
```

But learning this VM path first was useful.

---

### Check local server responses

```bash
curl localhost:3000
curl -I localhost:3002
```

## What I learned

A real deployment needs all of this to line up:

```txt
correct branches
correct env files
correct database
correct Prisma migration command
correct PM2 process names
correct app ports
correct nginx server_name
correct DNS records
correct SSH key direction
correct GitHub secrets
correct health checks
enough disk
enough memory
```

The annoying bugs were actually useful:

```txt
pnpm install killed        -> RAM/swap issue
No space left on device   -> EC2 disk issue
Next trying port 3000     -> start script issue
HTTP domain showing FE    -> nginx server_name typo
502 in CI health check    -> app not ready yet
node command not found    -> nvm not loaded in non-interactive SSH
```

This was painful, but it made the whole deployment path much clearer.

---

## Some articles/docs

Prisma Turborepo guide:

```txt
https://www.prisma.io/docs/guides/deployment/turborepo
```

DigitalOcean nginx reverse proxy guide:

```txt
https://www.digitalocean.com/community/tutorials/how-to-configure-nginx-as-a-reverse-proxy-on-ubuntu-22-04
```

AWS EBS filesystem expansion docs:

```txt
https://docs.aws.amazon.com/ebs/latest/userguide/recognize-expanded-volume-linux.html
```

Medium EC2 disk expansion article I referred to:

```txt
https://atsss.medium.com/how-to-expand-the-disk-size-in-ec2-b35507772e01
```

PM2 docs:

```txt
https://pm2.keymetrics.io/docs/usage/quick-start/
```

GitHub Actions secrets docs:

```txt
https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions
```

nvm docs:

```txt
https://github.com/nvm-sh/nvm
```

---

## Final status

This project successfully ran on:

```txt
staging AWS EC2
production AWS EC2
staging Postgres database
production Postgres database
custom subdomains
PM2 processes
nginx reverse proxy
GitHub Actions staging deploy
GitHub Actions production deploy
```

Final deployment flow:

```txt
push to main
-> staging deploy

merge main into production
-> push production
-> production deploy
```

This project can now be closed and used as a reference before moving into Docker-based deployment.
