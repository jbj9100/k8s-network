# Kubernetes Network Testing Tool

웹 기반 UI를 통해 Kubernetes 환경에서 네트워크 연결 및 통신을 테스트할 수 있는 도구입니다.

## 기능

- **네트워크 연결 테스트**:

  - **Ping 테스트**: 호스트/IP 주소에 대한 ICMP ping 테스트
  - **Traceroute 테스트**: 네트워크 경로 추적
  - **DNS 조회(nslookup)**: 도메인 이름 해석 및 특정 DNS 레코드 조회 (A, AAAA, MX, TXT 등)
  - **TCP 포트 연결 테스트**: 지정된 호스트와 포트에 대한 TCP 연결 테스트

- **데이터베이스 연결 및 쿼리 테스트**:

  - **MySQL/MariaDB**:
    - 연결 테스트
    - SQL 쿼리 테스트 (읽기 전용)
  - **PostgreSQL**:
    - 연결 테스트
    - SQL 쿼리 테스트 (읽기 전용)
  - **MongoDB**:
    - 연결 테스트
    - 쿼리 테스트 (읽기 전용)

- **메시징 및 캐시 시스템 테스트**:

  - **Redis**: 연결 테스트 및 정보 확인
  - **RabbitMQ**: 연결 테스트

- **웹 기반 프로토콜 테스트**:

  - **HTTP API 테스트**: 다양한 HTTP 메서드로 API 엔드포인트 요청
  - **WebSocket 테스트**: WebSocket 연결 및 메시지 송수신
  - **SSL/TLS 인증서 검사**: 호스트 SSL 인증서 정보 확인

- **시스템 정보**:
  - 호스트 이름, 플랫폼, 아키텍처, 네트워크 인터페이스 등 시스템 정보 확인

## 설치 및 실행 방법

### 로컬 실행

```bash
# 의존성 설치
npm install

# 애플리케이션 실행
npm start
```

### Docker로 실행

```bash
# Docker 이미지 빌드
docker build -t network-test:latest .

# Docker 컨테이너 실행
docker run -p 3000:3000 network-test:latest
```

### Kubernetes에 배포

```bash
# Kubernetes 디렉토리로 이동
cd k8s

# Deployment 및 Service 배포
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

## Kubernetes 매니페스트 수정

배포하기 전에 필요에 따라 `k8s/deployment.yaml` 파일의 이미지 태그를 업데이트하세요:

```yaml
image: your-registry/network-test:your-tag
```

## 매니페스트 구성 설명

- **deployment.yaml**: Pod 배포, 리소스 제한, 헬스 체크 설정
- **service.yaml**: 서비스 노출(NodePort 타입으로 설정되어 있음)

## 브라우저 접속

서비스가 배포된 후 다음 URL로 접속할 수 있습니다:

- `http://<node-ip>:<node-port>` (NodePort 타입)
- `http://network-test.your-namespace.svc.cluster.local` (클러스터 내부에서)

## 보안 고려사항

- 이 도구는 내부 네트워크 및 서비스 테스트용으로 설계되었습니다.
- 공개 인터넷에 노출하지 마십시오.
- 데이터베이스 쿼리는 읽기 전용(SELECT)으로 제한되어 있습니다.
- 운영 환경에 배포할 때는 적절한 네트워크 정책과 RBAC를 설정하세요.
