## Builder
FROM node:25.6.1-alpine3.23 as builder

WORKDIR /src

COPY .npmrc package.json package-lock.json /src/
RUN npm ci
COPY . /src/
ENV NODE_OPTIONS=--max_old_space_size=4096
RUN npm run build


## App
FROM nginx:1.29.5-alpine3.23

RUN apk add --no-cache jq

COPY --from=builder /src/dist /app
COPY --from=builder /src/docker-nginx.conf /etc/nginx/conf.d/default.conf

COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html

ENTRYPOINT ["entrypoint.sh"]

CMD ["nginx", "-g", "daemon off;"]
