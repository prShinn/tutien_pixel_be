package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="skill_player")
public class skillPlayerEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true)
    private String skillCode;
    private int level;
    private int playerId;
    private float rateBuff;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getSkillCode() {
        return skillCode;
    }

    public void setSkillCode(String skillCode) {
        this.skillCode = skillCode;
    }

    public int getPlayerId() {
        return playerId;
    }

    public void setPlayerId(int playerId) {
        this.playerId = playerId;
    }

    public int getLevel() {
        return level;
    }

    public void setLevel(int level) {
        this.level = level;
    }

    public float getRateBuff() {
        return rateBuff;
    }

    public void setRateBuff(float rateBuff) {
        this.rateBuff = rateBuff;
    }
}
