
FROM node:18

RUN apt-get update && apt-get install -y wget gnupg && \
    npm i -g playwright && \
    playwright install

WORKDIR /app
COPY . .

CMD ["npm", "start"]
