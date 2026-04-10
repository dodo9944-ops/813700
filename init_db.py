from app import app, db, User, Article

with app.app_context():
    db.create_all()

    # 기본 관리자 계정 생성
    if not User.query.filter_by(username='admin').first():
        admin = User(
            username='admin',
            name='관리자',
            email='admin@example.com',
            is_admin=True,
        )
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        print('관리자 계정 생성 완료 (admin / admin123)')
    else:
        print('관리자 계정이 이미 존재합니다.')

    # 샘플 게시글 추가
    if Article.query.count() == 0:
        admin = User.query.filter_by(username='admin').first()
        samples = [
            Article(title='2026년 상반기 투자 전망', content='2026년 상반기 국내외 투자 시장 전망 자료입니다.\n\n주요 내용:\n- 글로벌 경제 동향\n- 국내 주식 시장 분석\n- 채권 및 대체 투자 전략', category='investment', author_id=admin.id),
            Article(title='분산 투자 가이드', content='효과적인 분산 투자 전략에 대한 안내입니다.\n\n포트폴리오 구성 시 고려사항과 실전 사례를 정리했습니다.', category='investment', author_id=admin.id),
            Article(title='수도권 아파트 시세 동향', content='2026년 수도권 아파트 시세 동향 보고서입니다.\n\n지역별 가격 변동 추이와 향후 전망을 분석했습니다.', category='realestate', author_id=admin.id),
            Article(title='상업용 부동산 투자 가이드', content='상업용 부동산 투자 시 체크해야 할 핵심 포인트를 정리했습니다.\n\n수익률 분석 방법과 리스크 관리 전략을 포함합니다.', category='realestate', author_id=admin.id),
            Article(title='제25차 정기총회 안내', content='제25차 정기총회를 아래와 같이 개최합니다.\n\n일시: 2026년 5월 15일\n장소: 본사 대강당\n안건: 사업 보고 및 임원 선출', category='news', author_id=admin.id),
            Article(title='조합원 복지 프로그램 안내', content='2026년 조합원 복지 프로그램이 확대 시행됩니다.\n\n새로운 혜택 내용과 신청 방법을 확인해주세요.', category='news', author_id=admin.id),
        ]
        db.session.add_all(samples)
        db.session.commit()
        print(f'샘플 게시글 {len(samples)}건 등록 완료')

    print('데이터베이스 초기화 완료!')
