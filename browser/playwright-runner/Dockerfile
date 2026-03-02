FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY run.js /app/run.js

RUN npm init -y && npm i --omit=dev playwright@1.42.1

RUN mkdir -p /workspace/artifacts

CMD ["node", "/app/run.js"]
