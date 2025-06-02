FROM node:18

# Install required dependencies
RUN apt-get update && apt-get install -y wget gnupg

# Set working directory
WORKDIR /app

# Copy only package files first to leverage Docker cache
COPY package.json package-lock.json* ./

# Install local dependencies (this installs Playwright properly)
RUN npm install

# Install required browsers
RUN npx playwright install

# Copy the rest of the app
COPY . .

# Run the app
CMD ["npm", "start"]
