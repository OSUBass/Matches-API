FROM node:14
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install
COPY . .
ENV PORT=8000
ENV GOOGLE_APPLICATION_CREDENTIALS='./cloudport-351121-3f2b5407496c.json'
EXPOSE ${PORT}
CMD ["npm", "start"]