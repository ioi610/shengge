import XCTest
final class PracticeUITests: XCTestCase {
    func testDemoAndVideoHistory() {
        let app=XCUIApplication();app.launch()
        let sample=app.buttons["播放咖啡馆示例"]
        XCTAssertTrue(sample.waitForExistence(timeout:15));sample.tap()
        let shadow=app.buttons["跟读"]
        let enabled=NSPredicate(format:"enabled == true")
        let loaded=expectation(for:enabled,evaluatedWith:shadow)
        wait(for:[loaded],timeout:30)
        shadow.tap()
        XCTAssertTrue(app.buttons["退出练习"].waitForExistence(timeout:8))
        app.buttons["返回视频列表"].tap()
        XCTAssertFalse(sample.exists)
        XCTAssertEqual(app.buttons.containing(.staticText,identifier:"駅前のカフェ").count,1)
    }
}
