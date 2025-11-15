# Use a small Node image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install deps
COPY package.json ./
RUN npm install --production

# Copy the rest of the source
COPY . .

# Railway will inject PORT, default to 3000
ENV PORT=3000
EXPOSE 3000

# Start the mux server
CMD ["npm", "start"]
