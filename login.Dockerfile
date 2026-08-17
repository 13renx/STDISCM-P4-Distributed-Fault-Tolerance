FROM node:24-alpine

WORKDIR /app

COPY . .

EXPOSE 5001

RUN npm install

CMD ["npx", "nodemon", "--legacy-watch", "login.js"]