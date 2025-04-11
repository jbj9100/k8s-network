# K8s 네트워크 테스트 도구

네트워크 연결 테스트 및 진단을 위한 웹 기반 도구입니다. 다양한 프로토콜과 서비스에 대한 연결 테스트를 수행할 수 있습니다.

## 기능

- **기본 네트워크 테스트**: Ping, Traceroute, DNS Lookup, TCP/UDP 포트 테스트, Curl 요청
- **데이터베이스 테스트**: MySQL, PostgreSQL, MongoDB, Redis 연결 테스트
- **API 및 메시징 테스트**: HTTP API, WebSocket, RabbitMQ 연결 테스트
- **보안 및 시스템**: SSL 인증서 정보 확인, 시스템 정보 확인

## 실행 방법

### 로컬 실행

1. 의존성 패키지 설치:

```bash
npm install
```

2. 애플리케이션 실행:

```bash
npm start
```

3. 사용자 지정 포트로 실행 (기본값: 3000):

```bash
npm start --port=8080
```

> **참고**: 포트는 다음 방법 중 하나로 지정할 수 있습니다:
>
> - npm 옵션: `npm start --port=8080`
> - 환경 변수: `PORT=8080 npm start`
> - 명령줄 인수: `node src/server.js --port=8080`

### Docker 실행

### 이미지 빌드

```bash
docker build -t k8s-network-test .
```

### 컨테이너 실행

```bash
docker run -d --name network-tester -p 3000:3000 --cap-add=NET_ADMIN --cap-add=NET_RAW k8s-network-test
```

`--cap-add=NET_ADMIN --cap-add=NET_RAW` 옵션은 ping, traceroute 등의 네트워크 도구를 사용하기 위해 필요합니다.

### 또는 권한 모드로 실행 (개발/테스트 환경에서만 사용)

```bash
docker run -d --name network-tester -p 3000:3000 --privileged k8s-network-test
```

**주의**: `--privileged` 옵션은 컨테이너에 호스트 시스템에 대한 높은 수준의 권한을 부여합니다. 운영 환경에서는 최소 권한 원칙에 따라 `--cap-add` 옵션을 사용하는 것이 좋습니다.

## 폐쇄망에서 사용하기

이 Docker 이미지는 폐쇄망 환경에서 사용할 수 있도록 설계되었습니다. 필요한 모든 종속성이 이미지에 포함되어 있습니다.

1. 인터넷에 연결된 환경에서 이미지를 빌드합니다.
2. 이미지를 저장하여 폐쇄망으로 전송합니다:
   ```bash
   docker save -o k8s-network-test.tar k8s-network-test
   ```
3. 폐쇄망 환경에서 이미지를 로드합니다:
   ```bash
   docker load -i k8s-network-test.tar
   ```
4. 위의 실행 명령을 사용하여 컨테이너를 시작합니다.

## 접속 방법

브라우저에서 `http://localhost:3000`로 접속합니다.

수정1
