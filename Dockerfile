# 빌드 스테이지
FROM node:20-alpine AS build

WORKDIR /app

# 패키지 파일 복사 및 프로덕션 종속성만 설치
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    # 불필요한 파일 제거
    find ./node_modules -type f -name "*.md" -delete && \
    find ./node_modules -type f -name "*.ts" -delete && \
    find ./node_modules -type d -name "test" -exec rm -rf {} + && \
    find ./node_modules -type d -name "tests" -exec rm -rf {} + && \
    find ./node_modules -type d -name "docs" -exec rm -rf {} + && \
    find ./node_modules -type d -name ".git" -exec rm -rf {} +

# 최종 스테이지
FROM node:20-alpine

# 필수 네트워크 도구만 설치
RUN apk add --no-cache \
    iputils \
    bind-tools \
    traceroute \
    curl \
    openssl \
    net-tools \
    netcat-openbsd \
    busybox-extras \
    # 빌드 도구는 제거
    && rm -rf /var/cache/apk/*

# 작업 디렉토리 설정
WORKDIR /app

# 필요한 파일만 복사
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY README.md ./

# 포트 환경변수 설정
ENV PORT=3000

# 포트 노출
EXPOSE 3000

# 실행 명령 - 포트 변경 가능
CMD ["node", "src/server.js"]

# Alpine에서는 실행 시 포트 변경 방법
# docker run -p 8080:8080 -e PORT=8080 k8s-network-test
