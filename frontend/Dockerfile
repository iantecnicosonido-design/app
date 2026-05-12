FROM node:18

WORKDIR /app

# Copiar dependencias primero
COPY package*.json ./

# INSTALACIÓN ROBUSTA (esto arregla tu error de ajv)
RUN npm install --legacy-peer-deps

# Copiar resto del proyecto
COPY . .

# Exponer React
EXPOSE 3000

# CRACO (tu proyecto usa CRACO, no Vite)
CMD ["npm", "start"]
