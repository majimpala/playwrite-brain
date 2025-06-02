FROM node:18

# Install basic dependencies
RUN apt-get update && apt-get install -y wget gnupg

# Set working directory
WORKDIR /app

# Copy package files first
COPY package.json package-lock.json* ./

# Install Node.js dependencies
RUN npm install

# Install system dependencies for running Playwright browsers
RUN npx playwright install-deps

# Install browser binaries (Chromium, Firefox, etc.)
RUN npx playwright install

# Copy the rest of the code
COPY . .

# Default command
CMD ["npm", "start"]
