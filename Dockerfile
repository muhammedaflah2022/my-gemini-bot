FROM node:18-slim

# Git ഇൻസ്റ്റാൾ ചെയ്യുന്നു
RUN apt-get update && apt-get install -y git

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "index.js"]
