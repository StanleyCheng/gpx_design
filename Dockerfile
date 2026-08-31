FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server/recognition.mjs ./server/recognition.mjs
COPY --chown=node:node index.html icon.svg favicon-32.png apple-touch-icon.png icon-192.png icon-512.png site.webmanifest ./
RUN mkdir .runtime && chown node:node .runtime
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server/recognition.mjs"]
